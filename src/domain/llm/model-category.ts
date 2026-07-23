import type { LLMProviderName, ModelCategory } from '@brabo/shared';

export function categoryForProvider(provider: LLMProviderName): ModelCategory {
  return provider === 'ollama' ? 'local' : 'cloud';
}
