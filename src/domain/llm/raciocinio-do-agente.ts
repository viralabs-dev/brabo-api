import { DEV_LEAD } from '../agents/agent-areas';

/**
 * O que o turno pede de RACIOCÍNIO ao provider, decidido num ponto só
 * (RN-782/783) pelos três casos de uso de turno.
 *
 * - Modelo sem `supportsReasoning`: nada.
 * - Modelo com `supportsReasoning`: `reasoning: true` — a FOLGA no
 *   `max_tokens` (RN-741), e nenhum campo de raciocínio (RN-782: aceitar o
 *   parâmetro não é pedir raciocínio).
 * - Dev agent de execução (`dev-<modulo>`, decisão do dono de 10/10): além
 *   disso, `reasoningOff: true` — o raciocínio vai DESLIGADO (RN-783).
 */
export function opcoesDeRaciocinio(
  supportsReasoning: boolean,
  agentId: string | undefined,
): { reasoning?: true; reasoningOff?: true } {
  if (!supportsReasoning) return {};
  return raciocinioDesligadoParaOAgente(agentId)
    ? { reasoning: true, reasoningOff: true }
    : { reasoning: true };
}

/**
 * Os dev agents de EXECUÇÃO (`dev-<modulo>`) rodam com o raciocínio desligado
 * (RN-783). O Dev Lead (`dev-lead`) é conversacional e fica de fora.
 */
export function raciocinioDesligadoParaOAgente(
  agentId: string | undefined | null,
): boolean {
  return (
    typeof agentId === 'string' &&
    agentId.startsWith('dev-') &&
    agentId !== DEV_LEAD
  );
}
