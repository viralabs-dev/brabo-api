import type {
  LLMProviderCapabilities,
  LLMProviderName,
  RoutingPreference,
} from '@brabo/shared';

/**
 * O critério com que um HUB escolhe o upstream que serve o modelo (ADR 0166,
 * RN-583). A lista em RUNTIME mora aqui porque `@brabo/shared` é só tipo; o
 * enum do Postgres (`routing_preference`, `db/schema/llm.ts`) e o DTO derivam
 * DESTA lista.
 */
export const PREFERENCIAS_DE_ROTEAMENTO = [
  'price',
  'throughput',
  'latency',
] as const satisfies readonly RoutingPreference[];

type Faltando = Exclude<
  RoutingPreference,
  (typeof PREFERENCIAS_DE_ROTEAMENTO)[number]
>;
const _listaCompleta: Faltando extends never ? true : never = true;
void _listaCompleta;

/**
 * Preferência pedida para modelo cujo provider não a declara. 422, no mesmo
 * filtro das outras recusas de binding: o pedido está bem formado, o que não
 * se sustenta é a combinação (ADR 0166, ponto 3).
 */
export class RoutingPreferenceNotSupportedError extends Error {
  constructor(readonly provider: LLMProviderName) {
    super(
      `O provider "${provider}" não declara a capability ` +
        `\`routingPreference\`: não há critério de roteamento a enviar para ` +
        `ele. A capability só é declarada quando provada por execução contra ` +
        `a API real, nunca por leitura de documentação.`,
    );
    this.name = 'RoutingPreferenceNotSupportedError';
  }
}

/**
 * A preferência que o binding vai GUARDAR, dada a escrita pedida (ADR 0166,
 * ponto 3):
 *
 * - `undefined` (campo ausente) PRESERVA a gravada — se o provider do modelo
 *   aceita; senão vira `null`. Omitir não limpa em silêncio, e também não
 *   deixa gravado um critério que o provider novo não entende;
 * - `null` limpa;
 * - valor, com provider sem a capability, RECUSA.
 *
 * O invariante: nenhum binding guarda preferência para provider que não a
 * declara.
 */
export function preferenciaDoBinding(input: {
  pedida: RoutingPreference | null | undefined;
  gravada: RoutingPreference | null;
  provider: { name: LLMProviderName; capabilities: LLMProviderCapabilities };
}): RoutingPreference | null {
  const aceita = input.provider.capabilities.routingPreference;
  if (input.pedida === undefined) return aceita ? input.gravada : null;
  if (input.pedida === null) return null;
  if (!aceita)
    throw new RoutingPreferenceNotSupportedError(input.provider.name);
  return input.pedida;
}

/**
 * O que vai ao FIO — e é isso, não o que o binding guarda, que congela em
 * `token_usage.routing_preference` (ADR 0166, ponto 5). Provider sem a
 * capability não recebe o campo, então a linha registra `null`: o que não foi
 * enviado não é procedência de nada.
 */
export function preferenciaEnviada(
  doBinding: RoutingPreference | null | undefined,
  capabilities: LLMProviderCapabilities,
): RoutingPreference | null {
  if (!capabilities.routingPreference) return null;
  return doBinding ?? null;
}

/**
 * A chave que prende a conversa de UM agente numa SESSAO ao upstream que a
 * atendeu (ADR 0221, RN-907): por agente + sessao, porque cada agente tem
 * prefixo proprio (instrucoes + ferramentas).
 */
export function chaveDeSessao(sessionId: string, agentId?: string): string {
  return agentId ? `brabo:${sessionId}:${agentId}` : `brabo:${sessionId}`;
}

/**
 * O fator do TETO DE PREÇO (ADR 0225, RN-917): `max_price` = preço de catálogo
 * × 1,5, por chamada. Fixo no código — decisão do dono de 27/10/2026.
 */
export const FATOR_DO_TETO_DE_PRECO = 1.5;

export interface TetoDePreco {
  inputPerMillionMicros: number;
  outputPerMillionMicros: number;
}

/**
 * O teto que vai ao fio, ou `null` (nada é enviado): provider sem a capability,
 * ou preço de catálogo desconhecido (0) em qualquer das duas pontas — teto 0
 * recusaria todo upstream.
 */
export function tetoDePreco(
  model: {
    inputPricePerMillionMicros: number;
    outputPricePerMillionMicros: number;
  },
  capabilities: LLMProviderCapabilities,
): TetoDePreco | null {
  if (!capabilities.priceCeiling) return null;
  if (
    !(model.inputPricePerMillionMicros > 0) ||
    !(model.outputPricePerMillionMicros > 0)
  )
    return null;
  return {
    inputPerMillionMicros: Math.round(
      model.inputPricePerMillionMicros * FATOR_DO_TETO_DE_PRECO,
    ),
    outputPerMillionMicros: Math.round(
      model.outputPricePerMillionMicros * FATOR_DO_TETO_DE_PRECO,
    ),
  };
}

/** A chamada COM teto recebeu "nenhum upstream cabe": repete UMA vez sem teto. */
export function devoRetentarSemTeto(input: {
  comTeto: boolean;
  errorCode: string | null;
}): boolean {
  return input.comTeto && input.errorCode === 'price_ceiling';
}
