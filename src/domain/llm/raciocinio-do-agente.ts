import { DEV_LEAD } from '../agents/agent-areas';

/** O gate de QA de Automação, único gate sem raciocínio (RN-838). */
export const QA_AUTOMACAO = 'qa-automacao';

/**
 * O que o turno pede de RACIOCÍNIO ao provider, decidido num ponto só
 * (RN-782/783) pelos três casos de uso de turno.
 *
 * - Modelo sem `supportsReasoning`: nada.
 * - Modelo com `supportsReasoning`: `reasoning: true` — a FOLGA no
 *   `max_tokens` (RN-741), e nenhum campo de raciocínio (RN-782: aceitar o
 *   parâmetro não é pedir raciocínio).
 * - Modelo com `reasoningBudget` provado (ADR 0223, RN-913): além da folga,
 *   `reasoningBudget: N`, que o provider manda como `reasoning.max_tokens`.
 * - Dev agent de execução (`dev-<modulo>`, decisão do dono de 10/10) e o QA
 *   de Automação (`qa-automacao`, RN-838): além disso, `reasoningOff: true` —
 *   o raciocínio vai DESLIGADO (RN-783).
 */
export function opcoesDeRaciocinio(
  supportsReasoning: boolean,
  agentId: string | undefined,
  reasoningBudget?: number | null,
): { reasoning?: true; reasoningOff?: true; reasoningBudget?: number } {
  if (!supportsReasoning) return {};
  if (raciocinioDesligadoParaOAgente(agentId))
    return { reasoning: true, reasoningOff: true };
  return reasoningBudget
    ? { reasoning: true, reasoningBudget }
    : { reasoning: true };
}

/**
 * Os dev agents de EXECUÇÃO (`dev-<modulo>`) rodam com o raciocínio desligado
 * (RN-783), e o QA de Automação (`qa-automacao`) também (RN-838, AT-504). O
 * Dev Lead (`dev-lead`) é conversacional e fica de fora; os demais gates
 * (`qa-estrategia` incluso) seguem como estão.
 */
export function raciocinioDesligadoParaOAgente(
  agentId: string | undefined | null,
): boolean {
  if (agentId === QA_AUTOMACAO) return true;
  return (
    typeof agentId === 'string' &&
    agentId.startsWith('dev-') &&
    agentId !== DEV_LEAD
  );
}
