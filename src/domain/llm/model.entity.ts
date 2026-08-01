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
   * Curadoria do OWNER (Fase 9c): se aparece no seletor e pode receber binding
   * novo. Modelo descoberto por sync entra `false`.
   */
  isActive: boolean;
  /**
   * Realidade REMOTA observada pelo sync. Eixo independente de `isActive`:
   * um modelo pode estar ativo e indisponível ao mesmo tempo — e quando o
   * provider o traz de volta, a escolha do owner continua valendo.
   */
  availability: ModelAvailability;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
