import { Injectable } from '@nestjs/common';
import type { LLMProviderName } from '@brabo/shared';
import { LLMProviderRegistry } from '../../application/ports/llm-provider-registry.port';
import type { LLMProvider } from '../../application/ports/llm-provider.port';
import { OllamaProvider } from './ollama-provider';
import { AnthropicProvider } from './anthropic-provider';
import { OpenAIProvider } from './openai-provider';

@Injectable()
export class LLMProviderRegistryImpl implements LLMProviderRegistry {
  constructor(
    private readonly ollama: OllamaProvider,
    private readonly anthropic: AnthropicProvider,
    private readonly openai: OpenAIProvider,
  ) {}

  get(provider: LLMProviderName): LLMProvider {
    switch (provider) {
      case 'ollama':
        return this.ollama;
      case 'anthropic':
        return this.anthropic;
      case 'openai':
        return this.openai;
    }
  }
}
