import type {
  NewOutboxEvent,
  OutboxEvent,
} from '../../domain/shared/outbox-event.entity';

export abstract class OutboxRepository {
  abstract append(input: NewOutboxEvent): Promise<void>;

  /**
   * Lote de linhas NÃO processadas de um `aggregateType`, em ordem de
   * chegada (`createdAt` ascendente) — mesmo filtro/ordem que
   * `Engine.Outbox.Drain.run_once/0` usa do lado Elixir para
   * `('session', 'task')`, aqui escopado a um `aggregateType` que o dreno do
   * engine nunca toca (ver `domain/graph/graph-projection-events.ts`).
   * Consumidor próprio do lado api — hoje só o `GraphProjector`.
   */
  abstract listUnprocessed(
    aggregateType: string,
    limit: number,
  ): Promise<OutboxEvent[]>;

  /** Marca uma linha como processada — só depois da gravação no destino ter sucesso. */
  abstract markProcessed(id: string): Promise<void>;
}
