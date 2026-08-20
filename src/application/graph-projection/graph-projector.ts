import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { OutboxRepository } from '../ports/outbox-repository.port';
import { SessionEventRepository } from '../ports/session-event-repository.port';
import { SessionRepository } from '../ports/session-repository.port';
import { RecordHandoffUseCase } from '../use-cases/graph/record-handoff.use-case';
import { RecordHypothesisUseCase } from '../use-cases/graph/record-hypothesis.use-case';
import { RecordAnamneseProfileUseCase } from '../use-cases/graph/record-anamnese-profile.use-case';
import { RecordInteractionUseCase } from '../use-cases/graph/record-interaction.use-case';
import { GraphUnavailableError } from '../../domain/graph/graph-errors';
import { GRAPH_PROJECTION_AGGREGATE_TYPE } from '../../domain/graph/graph-projection-events';
import type { OutboxEvent } from '../../domain/shared/outbox-event.entity';

/** Mesmo tamanho de lote que `Engine.Outbox.Drain.run_once/0` usa do lado Elixir. */
const BATCH_LIMIT = 50;

/**
 * Onda 2 da fundação do grafo de conhecimento (ver CLAUDE.md) — o
 * consumidor real que estava faltando. Drena `outbox_events` (mesma tabela
 * transacional que o produto já usa para tudo, `aggregate_type:
 * 'graph_projection'` — ver `domain/graph/graph-projection-events.ts` para
 * o porquê deste `aggregate_type` ser NOVO) e chama os casos de uso de
 * gravação do grafo (`RecordHandoffUseCase` e companhia), que já são
 * idempotentes por MERGE em chave natural.
 *
 * ## Poller próprio, mesmo espírito do `Engine.Outbox.Drain`
 *
 * `onModuleInit` arma um `setInterval` (default 2s, `GRAPH_PROJECTOR_INTERVAL_MS`)
 * — mesmo padrão de `DomainGaugesCollector`
 * (`infrastructure/observability/domain-gauges.collector.ts`): `.unref()`
 * para não segurar o shutdown gracioso, `onModuleDestroy` limpa o timer.
 * `drainOnce()` é público e não depende do timer — é o que os testes chamam
 * diretamente.
 *
 * ## Degradação: o item PERMANECE na outbox, nunca é perdido
 *
 * Se `GraphStore` lançar `GraphUnavailableError` num item do lote, o ciclo
 * PARA ali — os itens já processados neste ciclo ficam marcados
 * (`processed_at`), o item que falhou e todo o resto do lote ficam
 * `processed_at IS NULL` para o próximo ciclo tentar de novo. Não adianta
 * seguir tentando os demais itens do MESMO lote: se o grafo está fora do
 * ar, a próxima chamada também vai falhar. Erro de outra natureza (ex.:
 * evento sumiu do event log, payload incoerente) NÃO para o lote inteiro —
 * fica logado e o item específico continua para retry, sem bloquear os
 * outros atrás dele na fila.
 */
@Injectable()
export class GraphProjector implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GraphProjector.name);
  private timer?: NodeJS.Timeout;
  private draining = false;

  constructor(
    private readonly outbox: OutboxRepository,
    private readonly sessionEvents: SessionEventRepository,
    private readonly sessions: SessionRepository,
    private readonly recordHandoff: RecordHandoffUseCase,
    private readonly recordHypothesis: RecordHypothesisUseCase,
    private readonly recordAnamneseProfile: RecordAnamneseProfileUseCase,
    private readonly recordInteraction: RecordInteractionUseCase,
  ) {}

  onModuleInit(): void {
    const intervalMs = Number(process.env.GRAPH_PROJECTOR_INTERVAL_MS ?? 2000);
    this.timer = setInterval(() => void this.drainOnce(), intervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Um ciclo de drenagem. `draining` evita sobrepor dois ciclos quando o
   * Neo4j está lento e um ciclo ainda não terminou quando o timer dispara o
   * próximo — mesma proteção que o `OutboxDrainWorker` do engine ganha de
   * graça do Oban (um job por vez), reimplementada aqui à mão porque não
   * há fila de jobs do lado api.
   */
  async drainOnce(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      const rows = await this.outbox.listUnprocessed(
        GRAPH_PROJECTION_AGGREGATE_TYPE,
        BATCH_LIMIT,
      );

      for (const row of rows) {
        try {
          await this.project(row);
          await this.outbox.markProcessed(row.id);
        } catch (error) {
          if (error instanceof GraphUnavailableError) {
            this.logger.warn(
              `Neo4j indisponível — outbox ${row.id} (${row.eventType}) ` +
                'permanece para retry; parando o ciclo (o resto do lote ' +
                'falharia pelo mesmo motivo).',
            );
            return;
          }
          this.logger.error(
            `Falha ao projetar outbox ${row.id} (${row.eventType}): ` +
              `${describeError(error)} — item permanece para retry.`,
          );
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async project(row: OutboxEvent): Promise<void> {
    switch (row.eventType) {
      case 'handoff.offered':
        return this.projectHandoff(row);
      case 'psychologist.hypothesis_proposed':
        return this.projectHypothesis(row);
      case 'anamnese.profile_updated':
        return this.projectAnamneseProfile(row);
      case 'session.closed':
      case 'session.closed_abnormally':
        return this.projectSessionClosed(row);
      default:
        // Não deveria acontecer — só GRAPH_PROJECTABLE_EVENT_TYPES grava
        // linha aqui. Registrado e SEM lançar: retentar um tipo sem handler
        // pra sempre não teria efeito nenhum.
        this.logger.warn(
          `Tipo de evento sem handler de projeção: ${row.eventType} (outbox ${row.id})`,
        );
    }
  }

  private async projectHandoff(row: OutboxEvent): Promise<void> {
    const event = await this.findSourceEvent(row);
    if (!event) return;
    const payload = event.payload as { toAgent: string };

    await this.recordHandoff.execute({
      sessionId: event.sessionId,
      seq: event.seq,
      fromAgent: event.actor.id,
      toAgent: payload.toAgent,
    });
  }

  private async projectHypothesis(row: OutboxEvent): Promise<void> {
    const event = await this.findSourceEvent(row);
    if (!event) return;
    const payload = event.payload as {
      hypothesisId: string;
      hipotese: string;
      evidenceEventIds: string[];
    };

    const evidenceSeqs = await this.resolveSeqs(
      event.sessionId,
      payload.evidenceEventIds,
    );

    await this.recordHypothesis.execute({
      hypothesisId: payload.hypothesisId,
      sessionId: event.sessionId,
      descricao: payload.hipotese,
      // Esta projeção só consome `psychologist.hypothesis_proposed` — o
      // nascimento da hipótese. `accepted`/`dismissed` (que no domínio do
      // Postgres têm vocabulário próprio) ainda não têm projeção; toda
      // hipótese que chega aqui está, do ponto de vista do grafo, `ativa`.
      // Fechar esse acompanhamento é consumo futuro, fora desta onda.
      status: 'ativa',
      evidenceSeqs,
    });
  }

  private async projectAnamneseProfile(row: OutboxEvent): Promise<void> {
    const event = await this.findSourceEvent(row);
    if (!event) return;
    const payload = event.payload as {
      userId: string;
      competency: string;
      level: string;
    };

    await this.recordAnamneseProfile.execute({
      userId: payload.userId,
      dimensao: payload.competency,
      proficiencia: payload.level,
    });
  }

  private async projectSessionClosed(row: OutboxEvent): Promise<void> {
    const { sessionId, projectId } = row.payload as {
      sessionId: string;
      projectId: string;
    };

    const session = await this.sessions.findInProject(projectId, sessionId);
    if (!session) return;

    // `nextSeq` é a PRÓXIMA seq a atribuir — o último seq real é `nextSeq -
    // 1`. Sessão fechada sem nenhum evento (`nextSeq === 1`) não tem janela
    // nenhuma pra consolidar.
    const seqFim = session.nextSeq - 1;
    if (seqFim < 1) return;

    await this.recordInteraction.execute({
      userId: session.createdBy,
      projectId,
      sessionId,
      seqInicio: 1,
      seqFim,
    });
  }

  /** `payload.eventId` (gravado por AppendSessionEventUseCase) → o envelope completo do event log. */
  private async findSourceEvent(row: OutboxEvent) {
    const { eventId } = row.payload as { eventId: string };
    const event = await this.sessionEvents.findById(eventId);
    if (!event) {
      this.logger.warn(
        `Outbox ${row.id} aponta pro evento ${eventId}, que não existe mais no event log — pulando.`,
      );
    }
    return event;
  }

  private async resolveSeqs(
    sessionId: string,
    eventIds: string[],
  ): Promise<number[]> {
    const seqs: number[] = [];
    for (const id of eventIds) {
      const event = await this.sessionEvents.findById(id);
      // Mesma checagem de pertencimento que ProposeHypothesesUseCase já faz
      // na escrita — aqui é defensivo (o dado já passou validado), não uma
      // segunda regra de negócio.
      if (event && event.sessionId === sessionId) seqs.push(event.seq);
    }
    return seqs;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
