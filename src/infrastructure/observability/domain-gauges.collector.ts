import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { BraboMetrics } from './brabo-metrics';
import { DRIZZLE } from '../persistence/drizzle/drizzle-client';
import type { DrizzleDb } from '../persistence/drizzle/drizzle-client';
import { sessions, stories, tasks } from '../../db/schema';

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
      await Promise.all([this.collectSessions(), this.collectBlockedTasks()]);
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
}
