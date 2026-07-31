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
  latencyMs: number;
  bindingOrigin: ModelBindingScope | null;
  /** Quem serviu de fato, quando a chamada passou por um hub (Fase 9b). */
  upstreamProvider: string | null;
  createdAt: Date;
}
