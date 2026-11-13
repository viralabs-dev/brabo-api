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

  /**
   * Marca como processadas TODAS as pendentes de um `aggregateType` e devolve
   * quantas foram. Só para o consumidor que decidiu descartá-las (grafo não
   * configurado, RN-1148); nunca no caminho de entrega normal.
   */
  abstract markAllProcessed(aggregateType: string): Promise<number>;

  /**
   * Linhas de um `eventType` criadas DEPOIS de `after`, processadas ou não, em
   * ordem de chegada. Para o consumidor que NÃO é dono da linha (o engine drena
   * e marca `project.trunk_merged`): ele lê sem marcar e guarda a própria marca
   * d'água. Nunca chame `markProcessed` sobre o que sair daqui.
   */
  abstract listByEventTypeAfter(
    eventType: string,
    after: Date,
    limit: number,
  ): Promise<OutboxEvent[]>;
}
