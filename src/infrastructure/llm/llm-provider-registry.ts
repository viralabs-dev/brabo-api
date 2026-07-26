import { Injectable } from '@nestjs/common';
import type { LLMProviderName } from '@brabo/shared';
import { LLMProviderRegistry } from '../../application/ports/llm-provider-registry.port';
import type { LLMProvider } from '../../application/ports/llm-provider.port';
import { OllamaProvider } from './ollama-provider';
import { AnthropicProvider } from './anthropic-provider';
import { OpenAIProvider } from './openai-provider';
import { TracedLLMProvider } from './traced-llm-provider';
import { BraboMetrics } from '../observability/brabo-metrics';

@Injectable()
export class LLMProviderRegistryImpl implements LLMProviderRegistry {
  constructor(
    private readonly ollama: OllamaProvider,
    private readonly anthropic: AnthropicProvider,
    private readonly openai: OpenAIProvider,
    private readonly metrics: BraboMetrics,
  ) {}

  /**
   * Ponto único por onde toda chamada de LLM passa — e por isso o lugar certo
   * para envolver o provider em span e contador de erro (Fase 5, item 3).
   * Instrumentar aqui cobre os três providers de uma vez, e cobre o próximo sem
   * que alguém precise lembrar.
   *
   * Os decorators são memoizados: um novo por chamada de `get()` criaria objeto
   * por turno de LLM sem necessidade nenhuma.
   */
  private readonly traced = new Map<LLMProviderName, LLMProvider>();

  get(provider: LLMProviderName): LLMProvider {
    const cached = this.traced.get(provider);
    if (cached) return cached;

    const inner = this.resolve(provider);
    const wrapped = new TracedLLMProvider(inner, this.metrics);
    this.traced.set(provider, wrapped);
    return wrapped;
  }

  private resolve(provider: LLMProviderName): LLMProvider {
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
