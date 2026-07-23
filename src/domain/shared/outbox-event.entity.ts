/** Transactional outbox — gravado na mesma transação da escrita de domínio que o originou. */
export interface OutboxEvent {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  createdAt: Date;
  processedAt: Date | null;
}

export interface NewOutboxEvent {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
}
