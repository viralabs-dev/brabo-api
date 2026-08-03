import type { LLMProviderName } from '@brabo/shared';

export const MODEL_AVAILABILITIES = ['available', 'unavailable'] as const;
export type ModelAvailability = (typeof MODEL_AVAILABILITIES)[number];

export interface Model {
  id: string;
  provider: LLMProviderName;
  name: string;
  displayName: string;
  inputPricePerMillionMicros: number;
  outputPricePerMillionMicros: number;
  /** Também é o `context_length` das capabilities do modelo. */
  contextWindow: number | null;
  /**
   * Capabilities DO MODELO (Fase 9a — ADR 0041), não do provider: um provider
   * pode falar tool calling e o modelo específico não. Quem decide se um
   * binding é válido olha estas, nunca as do provider.
   */
  supportsToolCalling: boolean;
  supportsStreaming: boolean;
  supportsVision: boolean;
  /**
   * Preço digitado da doc do provider, não sincronizado (Fase 9b). O sync da
   * Fase 9c não sobrescreve linha marcada sem decisão explícita.
   */
  manualPricing: boolean;
  /**
   * Realidade REMOTA observada pelo sync. Eixo independente da curadoria: um
   * modelo pode estar ativo num workspace e indisponível no provider ao mesmo
   * tempo — e quando o provider o traz de volta, a escolha de quem curou
   * continua valendo.
   */
  availability: ModelAvailability;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * O modelo COM a curadoria de um workspace específico (ADR 0049).
 *
 * `isActive` saiu de `Model` de propósito. Ele nunca foi propriedade do
 * modelo: era uma decisão de quem opera, e mantê-lo na entidade global era o
 * que fazia um owner do workspace A ligar um modelo para o B. Aqui ele volta,
 * mas amarrado ao workspace em que a pergunta foi feita — e um tipo que só
 * existe quando há workspace na mão impede que a distinção se perca de novo.
 */
export interface ModelComCuradoria extends Model {
  /**
   * Curadoria do OWNER daquele workspace: se aparece no seletor e pode
   * receber binding novo. Modelo descoberto por sync não tem linha de
   * curadoria, e ausência de linha é `false` (RN-043).
   */
  isActive: boolean;
}
