import type { LLMProviderName } from '@brabo/shared';
import type { LLMProvider } from './llm-provider.port';

export abstract class LLMProviderRegistry {
  abstract get(provider: LLMProviderName): LLMProvider;
}
