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

// AT-157 (RN-579): ações que só valem DEPOIS de a transação mais externa
// confirmar — hoje, avisar o canal da sessão de uma escrita. Avisar de dentro
// da transação faria a web buscar antes do commit e não achar o evento; avisar
// de uma transação desfeita a faria buscar por nada.
const alsPosCommit = new AsyncLocalStorage<Array<() => void>>();

export function runWithPosCommit<T>(
  pendentes: Array<() => void>,
  work: () => Promise<T>,
): Promise<T> {
  return alsPosCommit.run(pendentes, work);
}

/** Roda `acao` após o commit do escopo transacional; sem transação, na hora. */
export function aposCommit(acao: () => void): void {
  const pendentes = alsPosCommit.getStore();
  if (pendentes) pendentes.push(acao);
  else acao();
}

// AT-157: a escrita veio do ENGINE (rota `/internal/*`)? Então o engine já
// avisa pela fachada dele, e a api avisar de novo seria um aviso em dobro.
const alsOrigemEngine = new AsyncLocalStorage<true>();

export function runComoEngine<T>(work: () => T): T {
  return alsOrigemEngine.run(true, work);
}

export function veioDoEngine(): boolean {
  return alsOrigemEngine.getStore() === true;
}
