/**
 * Instância de QA efêmera (AT-612, ADR 0229, RN-935). Puro.
 *
 * A CHAVE é o que o broker usa no NOME do container
 * (`brabo-qa-<workspaceDirName>-<chave>`): os 8 primeiros [a-z0-9] do taskId,
 * minúsculos e sem hífen. A api é a única que a calcula.
 */
export const STATUS_ATIVOS_DE_QA = ['provisioning', 'running'] as const;
export type StatusDeInstanciaDeQa =
  'provisioning' | 'running' | 'failed' | 'removed';

export function chaveDeQa(taskId: string): string {
  return taskId
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8);
}

const CHAVE = /^[a-z0-9]{8}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O broker da `dev` manda a CHAVE (8) em `task=`; o desenho manda o id completo. Aceita os dois. */
export function formaDaReferenciaDeTarefa(
  ref: string,
): 'id' | 'chave' | 'invalida' {
  if (UUID.test(ref)) return 'id';
  if (CHAVE.test(ref)) return 'chave';
  return 'invalida';
}
