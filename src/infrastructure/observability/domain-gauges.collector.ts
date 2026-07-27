import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { BraboMetrics } from './brabo-metrics';
import { DRIZZLE } from '../persistence/drizzle/drizzle-client';
import type { DrizzleDb } from '../persistence/drizzle/drizzle-client';
import {
  backupRuns,
  rateLimitHits,
  sessions,
  stories,
  tasks,
} from '../../db/schema';

/**
 * Coleta periódica das métricas que são ESTADO, não evento (Fase 5, item 4).
 *
 * "Quantas sessões estão ativas agora" e "quantas tasks estão bloqueadas" não
 * se derivam de contador: não existe evento de "deixou de estar ativa" que
 * sobreviva a um restart de processo. A fonte correta é o banco.
 *
 * Roda num intervalo próprio, e não sob demanda no `/metrics`, por dois
 * motivos: o scrape tem timeout e não deve ficar preso numa consulta, e vários
 * scrapes simultâneos (Prometheus + curl de alguém investigando) não devem
 * multiplicar consultas.
 */
@Injectable()
export class DomainGaugesCollector implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DomainGaugesCollector.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly metrics: BraboMetrics,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
  ) {}

  onModuleInit(): void {
    const intervalMs = Number(process.env.METRICS_GAUGE_INTERVAL_MS ?? 15_000);

    // Não espera o primeiro intervalo: sem isto, um scrape logo depois do boot
    // veria zero e o dashboard mostraria uma queda que nunca aconteceu.
    void this.collect();

    this.timer = setInterval(() => void this.collect(), intervalMs);
    // Sem unref, o interval segura o processo aberto e o SIGTERM não completa.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async collect(): Promise<void> {
    try {
      await Promise.all([
        this.collectSessions(),
        this.collectBlockedTasks(),
        this.collectBackup(),
        this.pruneRateLimit(),
      ]);
    } catch (error) {
      // Uma falha de coleta não pode derrubar a api nem parar o timer: o
      // Prometheus simplesmente vê o valor anterior até a próxima rodada.
      this.logger.warn(
        `falha ao coletar gauges de domínio: ${(error as Error).message}`,
      );
    }
  }

  private async collectSessions(): Promise<void> {
    const rows = await this.db
      .select({
        projectId: sessions.projectId,
        total: sql<number>`count(*)::int`,
      })
      .from(sessions)
      .where(eq(sessions.status, 'active'))
      .groupBy(sessions.projectId);

    // `reset()` antes de reescrever: sem isso, um projeto que zerou mantém o
    // último valor para sempre (a série fica "grudada") e o dashboard mostra
    // sessões ativas que já acabaram.
    this.metrics.sessionsActive.reset();
    for (const row of rows) {
      this.metrics.sessionsActive.set({ project: row.projectId }, row.total);
    }

    const [closing] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(sessions)
      .where(eq(sessions.status, 'closing'));

    this.metrics.sessionsClosing.set(closing?.total ?? 0);
  }

  private async collectBlockedTasks(): Promise<void> {
    // `tasks` não tem project_id — o caminho é tasks.story_id -> stories.
    // E "blocked" é a coluna BOOLEANA, não um valor do enum de status: uma
    // task bloqueada volta para `todo` com blocked = true.
    const rows = await this.db
      .select({
        projectId: stories.projectId,
        total: sql<number>`count(*)::int`,
      })
      .from(tasks)
      .innerJoin(stories, eq(tasks.storyId, stories.id))
      .where(and(eq(tasks.blocked, true), isNotNull(stories.projectId)))
      .groupBy(stories.projectId);

    this.metrics.tasksBlocked.reset();
    for (const row of rows) {
      this.metrics.tasksBlocked.set({ project: row.projectId }, row.total);
    }
  }

  /**
   * Métricas de backup a partir de `backup_runs` (Fase 5, item 6).
   *
   * O CronJob não fala Prometheus — ele grava uma linha e termina. Quem
   * publica é a api, que já é scrapeada. Duas consultas, porque as perguntas
   * são diferentes: "quando foi o último SUCESSO" (o que o alerta de idade
   * usa) e "como terminou a ÚLTIMA execução" (que pega o caso de estar
   * falhando há três dias com um backup bom de quatro dias atrás).
   */
  private async collectBackup(): Promise<void> {
    const [sucesso] = await this.db
      .select({
        finishedAt: backupRuns.finishedAt,
        sizeBytes: backupRuns.sizeBytes,
      })
      .from(backupRuns)
      .where(eq(backupRuns.status, 'ok'))
      .orderBy(desc(backupRuns.finishedAt))
      .limit(1);

    if (sucesso) {
      const epoch = sucesso.finishedAt.getTime() / 1000;
      this.metrics.backupLastSuccessTimestamp.set(epoch);
      this.metrics.backupAgeSeconds.set(Math.max(0, Date.now() / 1000 - epoch));
      this.metrics.backupSizeBytes.set(sucesso.sizeBytes);
    } else {
      // -1 e não 0: "nunca houve backup" e "backup de 1970" são situações
      // diferentes, e um alerta de idade não pode confundir as duas.
      this.metrics.backupLastSuccessTimestamp.set(0);
      this.metrics.backupAgeSeconds.set(-1);
      this.metrics.backupSizeBytes.set(0);
    }

    const [ultima] = await this.db
      .select({ status: backupRuns.status })
      .from(backupRuns)
      .orderBy(desc(backupRuns.finishedAt))
      .limit(1);

    this.metrics.backupLastStatus.set(
      ultima ? (ultima.status === 'ok' ? 1 : 0) : -1,
    );
  }

  /**
   * Poda da janela do rate limit (Fase 5, item 7).
   *
   * A tabela recebe uma linha por request e só é consultada dentro da janela
   * configurada; sem poda ela cresce para sempre e o índice degrada. Roda
   * junto do collector em vez de num CronJob próprio porque é um DELETE por
   * intervalo — não justifica um Job, e aqui herda o tratamento de erro que
   * já existe (falhar a poda não pode derrubar a api).
   *
   * A margem sobre a janela é de propósito: apagar exatamente na borda
   * removeria hits que uma requisição concorrente ainda está contando.
   */
  private async pruneRateLimit(): Promise<void> {
    const janelaMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
    const retencaoMs = janelaMs * 2;

    await this.db
      .delete(rateLimitHits)
      .where(
        sql`${rateLimitHits.occurredAt} < now() - ${sql.raw(`interval '${Math.ceil(retencaoMs / 1000)} seconds'`)}`,
      );
  }
}
