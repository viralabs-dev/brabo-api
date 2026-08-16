import { describe, expect, it } from 'vitest';
import type { LLMProvider } from '../../../../src/application/ports/llm-provider.port';
import type { LLMProviderRegistry } from '../../../../src/application/ports/llm-provider-registry.port';
import type { LLMProviderName } from '@brabo/shared';
import { RagEmbeddingService } from '../../../../src/application/use-cases/rag/rag-embedding.service';
import { LLMConnectionError } from '../../../../src/domain/llm/llm-provider-errors';
import { RAG_EMBED_BATCH_SIZE } from '../../../../src/domain/rag/rag-search-limits';

class FakeEmbeddingProvider implements LLMProvider {
  name: LLMProviderName = 'ollama';
  readonly capabilities = {
    streaming: false,
    toolCalling: false,
    listModels: false,
    embeddings: true,
  };
  calls: string[][] = [];

  async *chat(): AsyncGenerator<never> {
    throw new Error('não usado neste teste');
  }

  async embed(inputs: readonly string[]) {
    this.calls.push([...inputs]);
    return {
      vectors: inputs.map((_, i) => [i, i + 1, i + 2]),
      dimensions: 3,
      model: 'nomic-embed-text',
      inputTokens: inputs.length * 2,
      estimated: false,
    };
  }
}

class ThrowingEmbeddingProvider implements LLMProvider {
  name: LLMProviderName = 'ollama';
  readonly capabilities = {
    streaming: false,
    toolCalling: false,
    listModels: false,
    embeddings: true,
  };

  async *chat(): AsyncGenerator<never> {
    throw new Error('não usado neste teste');
  }

  async embed(): Promise<never> {
    throw new LLMConnectionError('ollama', 'daemon fora do ar');
  }
}

class NoEmbedProvider implements LLMProvider {
  name: LLMProviderName = 'ollama';
  readonly capabilities = {
    streaming: true,
    toolCalling: true,
    listModels: false,
    embeddings: false,
  };

  async *chat(): AsyncGenerator<never> {
    throw new Error('não usado neste teste');
  }
}

function registryWith(provider: LLMProvider): LLMProviderRegistry {
  return { get: () => provider };
}

describe('RagEmbeddingService', () => {
  it('vetoriza em lote, respeitando RAG_EMBED_BATCH_SIZE, e devolve um vetor por entrada na ordem', async () => {
    const provider = new FakeEmbeddingProvider();
    const service = new RagEmbeddingService(registryWith(provider));

    const textos = Array.from({ length: RAG_EMBED_BATCH_SIZE + 5 }, (_, i) => `texto ${i}`);
    const resultado = await service.embedMany(textos);

    expect(resultado.available).toBe(true);
    expect(resultado.vectors).toHaveLength(textos.length);
    expect(resultado.vectors.every((v) => v !== null)).toBe(true);
    // Dois lotes: um de RAG_EMBED_BATCH_SIZE, um de 5.
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0]).toHaveLength(RAG_EMBED_BATCH_SIZE);
    expect(provider.calls[1]).toHaveLength(5);
  });

  it('embedMany([]) não chama o provider e devolve available: true', async () => {
    const provider = new FakeEmbeddingProvider();
    const service = new RagEmbeddingService(registryWith(provider));

    const resultado = await service.embedMany([]);

    expect(resultado).toEqual({ vectors: [], available: true });
    expect(provider.calls).toHaveLength(0);
  });

  it('CASO DE FALHA: provider sem a capability degrada para available: false, sem lançar', async () => {
    const service = new RagEmbeddingService(registryWith(new NoEmbedProvider()));

    const resultado = await service.embedMany(['a', 'b']);

    expect(resultado.available).toBe(false);
    expect(resultado.vectors).toEqual([null, null]);
    expect(resultado.reason).toMatch(/não declara a capability embeddings/);
  });

  it('CASO DE FALHA: provider que lança no meio do lote degrada o restante para null, sem lançar', async () => {
    const service = new RagEmbeddingService(registryWith(new ThrowingEmbeddingProvider()));

    const resultado = await service.embedMany(['a', 'b', 'c']);

    expect(resultado.available).toBe(false);
    expect(resultado.vectors).toEqual([null, null, null]);
    expect(resultado.reason).toMatch(/connection/);
  });

  it('embedQuery devolve o vetor único, ou null com o motivo quando indisponível', async () => {
    const ok = new RagEmbeddingService(registryWith(new FakeEmbeddingProvider()));
    const okResultado = await ok.embedQuery('pergunta');
    expect(okResultado.available).toBe(true);
    expect(okResultado.vector).toEqual([0, 1, 2]);

    const falho = new RagEmbeddingService(registryWith(new NoEmbedProvider()));
    const falhoResultado = await falho.embedQuery('pergunta');
    expect(falhoResultado.available).toBe(false);
    expect(falhoResultado.vector).toBeNull();
  });
});
