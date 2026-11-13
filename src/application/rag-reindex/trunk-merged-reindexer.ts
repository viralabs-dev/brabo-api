import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { OutboxRepository } from '../ports/outbox-repository.port';
import { IndexProjectDocsUseCase } from '../use-cases/rag/index-project-docs.use-case';

const BATCH_LIMIT = 50;
const EVENTO = 'project.trunk_merged';

/**
 * Reindexa `docs`/`adr` e `.brabo/memoria/` do projeto a cada merge na trunk
 * (AT-923, RN-1108). Antes só o botão "Reindexar agora" fazia isso.
 *
 * Quem DRENA `project.trunk_merged` é o engine (`TrunkMergedWorker`), que
 * marca a linha como processada. Por isso este consumidor só LÊ a outbox e
 * guarda a própria marca d'água, em memória — nunca chama `markProcessed`.
 * shortcut: a marca d'água nasce no boot, então um merge ocorrido com a api
 * fora do ar só é reindexado no próximo merge ou pelo botão; persistir a marca
 * se isso doer.
 *
 * Falha na reindexação só loga: não desfaz nem atrasa o merge, que já
 * aconteceu quando a linha existe.
 */
@Injectable()
export class TrunkMergedReindexer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrunkMergedReindexer.name);
  private timer?: NodeJS.Timeout;
  private draining = false;
  private watermark = new Date();

  constructor(
    private readonly outbox: OutboxRepository,
    private readonly indexDocs: IndexProjectDocsUseCase,
  ) {}

  onModuleInit(): void {
    const intervalMs = Number(process.env.RAG_REINDEX_POLL_INTERVAL_MS ?? 5000);
    this.timer = setInterval(() => void this.drainOnce(), intervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async drainOnce(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      const rows = await this.outbox.listByEventTypeAfter(
        EVENTO,
        this.watermark,
        BATCH_LIMIT,
      );
      // Um projeto reindexado uma vez por ciclo, mesmo com vários merges.
      const projetos = new Set(rows.map((r) => r.aggregateId));
      if (rows.length > 0) this.watermark = rows[rows.length - 1].createdAt;
      for (const projectId of projetos) {
        try {
          await this.indexDocs.execute(projectId);
        } catch (error) {
          this.logger.error(
            `Reindexação do merge falhou no projeto ${projectId}: ` +
              (error instanceof Error ? error.message : String(error)),
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Leitura da outbox falhou: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.draining = false;
    }
  }
}
