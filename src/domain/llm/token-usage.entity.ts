import type { LLMProviderName, RoutingPreference } from '@brabo/shared';
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
  /**
   * O preço acima foi DERIVADO de `custo ÷ tokens` da resposta, não veio do
   * catálogo (ADR 0179 no Jev, ADR 0188 no chat). É o marcador de que
   * `costMicros` é o custo REAL que o provider disse ter cobrado.
   */
  priceImplicit: boolean;
  /**
   * O que o preço de CATÁLOGO teria cobrado pela mesma chamada — só quando
   * `costMicros` é o real (RN-665); `null` quando o número já é o do catálogo.
   */
  catalogCostMicros: number | null;
  /** O modelo que a resposta disse ter servido (`model` do frame), RN-665. */
  resolvedModelName: string | null;
  /** O id da resposta no provider (`gen-…` no OpenRouter), RN-665. */
  generationId: string | null;
  latencyMs: number;
  bindingOrigin: ModelBindingScope | null;
  /** Quem serviu de fato, quando a chamada passou por um hub (Fase 9b). */
  upstreamProvider: string | null;
  /**
   * O critério de roteamento que FOI AO FIO (ADR 0166, RN-583), congelado como
   * o preço. `null` = nada foi enviado.
   */
  routingPreference: RoutingPreference | null;
  createdAt: Date;
}
