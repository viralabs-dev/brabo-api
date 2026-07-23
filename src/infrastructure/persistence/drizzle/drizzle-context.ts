import { AsyncLocalStorage } from 'node:async_hooks';
import type { DrizzleDb } from './drizzle-client';

// Propaga a transação ativa para os repositórios sem precisar
// injetar `tx` explicitamente em cada método — cada repositório chama
// `currentDb(this.rootDb)` e recebe a tx ativa quando existir, ou a
// conexão raiz (pool) caso contrário.
const als = new AsyncLocalStorage<DrizzleDb>();

export function runWithTransaction<T>(
  tx: DrizzleDb,
  work: () => Promise<T>,
): Promise<T> {
  return als.run(tx, work);
}

export function currentTx(): DrizzleDb | undefined {
  return als.getStore();
}

export function currentDb(root: DrizzleDb): DrizzleDb {
  return als.getStore() ?? root;
}
