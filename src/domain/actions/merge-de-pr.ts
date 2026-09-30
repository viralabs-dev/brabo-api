import type { ProposedAction } from './proposed-action.entity';

/**
 * Por que um `git_merge` desta PR não pode nascer (AT-249, RN-663).
 *
 * Puro, sem IO: recebe as `git_merge` que o projeto já tem e diz se a nova
 * colide com alguma. Duas recusas, com código próprio cada uma:
 *
 * - `pr_ja_mergeado` — uma execução anterior já mergeou esta PR. Não há o que
 *   mergear; no uso real de 29/09 a `pr-6` teve TRÊS `git_merge` `executed`,
 *   porque o `LocalGitProvider` devolvia a PR mergeada sem erro.
 * - `merge_ja_proposto` — já há uma proposta VIVA (pendente, aprovada ou
 *   auto-aprovada, ainda sem desfecho) para esta PR. A tela já deduplicava;
 *   a api não, e é a api quem decide.
 *
 * Negada e falha NÃO contam: quem negou ou viu falhar pode querer tentar de
 * novo. E o gate de QA pendente NÃO é motivo de recusa, por decisão do dono
 * (30/09): a tela só AVISA. Nada aqui mexe no teto de merge em branch
 * protegida (RN-418, `decide.ts`) — isto só impede propor o que não existe.
 */
export type RecusaDeMerge = {
  code: 'pr_ja_mergeado' | 'merge_ja_proposto';
  message: string;
};

const VIVAS: readonly ProposedAction['status'][] = [
  'pending',
  'approved',
  'auto_approved',
];

export function pullRequestIdDoPayload(payload: unknown): string | null {
  const id = (payload as { pullRequestId?: unknown } | null)?.pullRequestId;
  if (typeof id === 'string' && id !== '') return id;
  if (typeof id === 'number') return String(id);
  return null;
}

/** Esta ação é um merge que JÁ mergeou a PR? */
export function mergeouAPr(
  acao: ProposedAction,
  pullRequestId: string,
): boolean {
  const r = acao.executionResult;
  return (
    acao.actionType === 'git_merge' &&
    acao.status === 'executed' &&
    r !== null &&
    'kind' in r &&
    r.kind === 'git_merge' &&
    r.state === 'merged' &&
    pullRequestIdDoPayload(acao.payload) === pullRequestId
  );
}

export function recusaDeMerge(
  pullRequestId: string,
  mergesDoProjeto: readonly ProposedAction[],
  ignorar?: string,
): RecusaDeMerge | null {
  const daPr = mergesDoProjeto.filter(
    (a) =>
      a.id !== ignorar &&
      a.actionType === 'git_merge' &&
      pullRequestIdDoPayload(a.payload) === pullRequestId,
  );

  if (daPr.some((a) => mergeouAPr(a, pullRequestId))) {
    return {
      code: 'pr_ja_mergeado',
      message: `A PR ${pullRequestId} já foi mergeada: não há o que mergear.`,
    };
  }
  if (daPr.some((a) => VIVAS.includes(a.status))) {
    return {
      code: 'merge_ja_proposto',
      message: `Já há um merge da PR ${pullRequestId} esperando decisão ou em execução: decida esse, em vez de propor outro.`,
    };
  }
  return null;
}
