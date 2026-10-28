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
 * - Modelo com `reasoningBudget` provado (ADR 0223, RN-914): além da folga,
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

/** Orçamento de raciocínio quando o modelo não declara `reasoningBudget` (RN-741). */
export const ORCAMENTO_DE_RACIOCINIO_PADRAO = 4096;

/**
 * Folga, em tokens, entre o orçamento e o raciocínio medido (AT-587, RN-916).
 * O `usage` do provider e a contagem caracteres/4 do aborto (ADR 0224) erram
 * por poucas centenas de tokens, e o corte ocorre um pouco ANTES do teto.
 */
export const FOLGA_DO_ORCAMENTO_DE_RACIOCINIO = 256;

/**
 * Retenta UMA vez com o raciocínio desligado (AT-587, RN-916)? Só quando a
 * resposta foi cortada, sem texto e sem tool call, e o raciocínio comeu o
 * orçamento (medido, ou o aborto da RN-915). Nunca no segundo ciclo, nunca se
 * o raciocínio já ia desligado nem se o provider não sabe desligá-lo.
 */
export function devoRetentarSemRaciocinio(a: {
  opcoes: { reasoning?: true; reasoningOff?: true; reasoningBudget?: number };
  aceitaRaciocinioDesligado: boolean | undefined;
  truncated: boolean;
  texto: string;
  toolCalls: number;
  abortado: boolean;
  reasoningTokens: number | null;
}): boolean {
  if (!a.opcoes.reasoning || a.opcoes.reasoningOff) return false;
  if (!a.aceitaRaciocinioDesligado) return false;
  if (!a.truncated || a.texto !== '' || a.toolCalls > 0) return false;
  const limite =
    (a.opcoes.reasoningBudget ?? ORCAMENTO_DE_RACIOCINIO_PADRAO) -
    FOLGA_DO_ORCAMENTO_DE_RACIOCINIO;
  return a.abortado || (a.reasoningTokens ?? 0) >= limite;
}
