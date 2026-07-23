/**
 * Fronteira transacional. Os repositórios Drizzle participam
 * automaticamente da transação ativa (via contexto assíncrono) sem
 * precisar receber `tx` explicitamente — ver
 * infrastructure/persistence/drizzle/drizzle-context.ts.
 */
export abstract class UnitOfWork {
  abstract runInTransaction<T>(work: () => Promise<T>): Promise<T>;
}
