import type { LLMProviderName } from '@brabo/shared';

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
   * Capabilities DO MODELO (Fase 9a — ADR 0040), não do provider: um provider
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
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
