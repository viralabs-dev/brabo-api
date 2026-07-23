import type { LLMProviderName } from '@brabo/shared';
import type { TokenUsage } from '../../domain/llm/token-usage.entity';
import type { Actor } from '../../domain/sessions/session-event.entity';
import type { ModelBindingScope } from '../../domain/llm/model-binding-scope';

export interface RecordTokenUsageInput {
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
}

export abstract class TokenUsageRepository {
  abstract record(input: RecordTokenUsageInput): Promise<TokenUsage>;
}
