import type { LLMProviderName } from '@brabo/shared';
import type { Actor } from '../sessions/session-event.entity';
import type { ModelBindingScope } from './model-binding-scope';

export interface TokenUsage {
  id: string;
  sessionId: string;
  actor: Actor;
  provider: LLMProviderName;
  modelId: string | null;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
  costMicros: number;
  /**
   * O PREÇO que produziu o `costMicros` acima, congelado no instante da
   * chamada (Fase 9c, RN-044). Sem ele o custo é um número sem procedência:
   * dá para conferir a soma, não para conferir a CONTA. Com ele,
   * `tokens x preço = custo` é reproduzível anos depois, mesmo que o preço do
   * modelo tenha mudado três vezes.
   */
  inputPricePerMillionMicros: number;
  outputPricePerMillionMicros: number;
  latencyMs: number;
  bindingOrigin: ModelBindingScope | null;
  /** Quem serviu de fato, quando a chamada passou por um hub (Fase 9b). */
  upstreamProvider: string | null;
  createdAt: Date;
}
