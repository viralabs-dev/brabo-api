import { describe, it, expect } from 'vitest';
import type {
  ChatMessage,
  ChatOptions,
  ChatStreamChunk,
  LLMProviderCapabilities,
  LLMProviderName,
  ModeloDoCatalogo,
} from '@brabo/shared';
import { LLMProvider } from '../../../src/application/ports/llm-provider.port';
import { TracedLLMProvider } from '../../../src/infrastructure/llm/traced-llm-provider';
import { BraboMetrics } from '../../../src/infrastructure/observability/brabo-metrics';
import { OllamaProvider } from '../../../src/infrastructure/llm/ollama-provider';
import { OpenRouterProvider } from '../../../src/infrastructure/llm/openrouter-provider';
import { NvidiaNimProvider } from '../../../src/infrastructure/llm/nvidia-nim-provider';
import { TogetherProvider } from '../../../src/infrastructure/llm/together-provider';
import { DeepInfraProvider } from '../../../src/infrastructure/llm/deepinfra-provider';
import { BitdeerProvider } from '../../../src/infrastructure/llm/bitdeer-provider';
import { VultrProvider } from '../../../src/infrastructure/llm/vultr-provider';

/**
 * O decorator de tracing é o ÚNICO caminho até um provider: o registry envolve
 * todos em `get()`. Um membro do port que ele esqueça de encaminhar some do
 * sistema inteiro, e some em silêncio.
 *
 * Foi o que aconteceu com `listModels`. O decorator encaminhava `name`,
 * `capabilities` e `chat`; o método opcional ficou de fora. Como o sync de
 * catálogo exige os DOIS lados — `capabilities.listModels` e o método —, ele
 * pulava os nove providers com `pulado: 'sem_capability'`. O relatório mentia:
 * a capability estava declarada, quem a perdia era o decorator. Sintoma final:
 * nenhum modelo de provider remoto jamais aparecia no seletor, e a tela dizia
 * "sem capability" sobre um provider que a tinha.
 */

class ProviderFalso extends LLMProvider {
  readonly name: LLMProviderName = 'openrouter';
  readonly capabilities: LLMProviderCapabilities = {
    streaming: true,
    toolCalling: true,
    listModels: true,
  };
  chaveRecebida: string | undefined = undefined;

  // eslint-disable-next-line @typescript-eslint/require-await
  async *chat(
    _messages: ChatMessage[],
    _options: ChatOptions,
  ): AsyncGenerator<ChatStreamChunk> {
    yield { type: 'text_delta', text: 'ok' };
  }

  listModels(apiKey?: string): Promise<ModeloDoCatalogo[]> {
    this.chaveRecebida = apiKey;
    return Promise.resolve([
      { name: 'modelo-remoto', displayName: 'Modelo remoto' },
    ]);
  }
}

class ProviderSemCatalogo extends LLMProvider {
  readonly name: LLMProviderName = 'ollama';
  readonly capabilities: LLMProviderCapabilities = {
    streaming: true,
    toolCalling: false,
    listModels: false,
  };

  // eslint-disable-next-line @typescript-eslint/require-await
  async *chat(): AsyncGenerator<ChatStreamChunk> {
    yield { type: 'text_delta', text: 'ok' };
  }
}

const metrics = new BraboMetrics();

describe('TracedLLMProvider', () => {
  it('encaminha listModels — era o membro perdido', async () => {
    const inner = new ProviderFalso();
    const traced = new TracedLLMProvider(inner, metrics);

    expect(typeof traced.listModels).toBe('function');
    const catalogo = await traced.listModels!('sk-chave');

    expect(catalogo.map((m) => m.name)).toEqual(['modelo-remoto']);
    // A chave precisa CHEGAR ao provider: encaminhar o método e engolir o
    // argumento daria um catálogo vazio de um provider que exige credencial.
    expect(inner.chaveRecebida).toBe('sk-chave');
  });

  /**
   * "Quem não declara não expõe" é contrato do port. Se o decorator declarasse
   * `listModels` como método de classe, ele existiria SEMPRE — e o guarda do
   * sync passaria a chamar um método que só falharia lá dentro, trocando um
   * pulo explícito por uma exceção.
   */
  it('NÃO inventa listModels em provider que não lista', () => {
    const traced = new TracedLLMProvider(new ProviderSemCatalogo(), metrics);

    expect(traced.listModels).toBeUndefined();
  });

  it('encaminha nome e capabilities', () => {
    const traced = new TracedLLMProvider(new ProviderFalso(), metrics);

    expect(traced.name).toBe('openrouter');
    expect(traced.capabilities.listModels).toBe(true);
  });

  it('chat continua streamando através do decorator', async () => {
    const traced = new TracedLLMProvider(new ProviderFalso(), metrics);

    const chunks: ChatStreamChunk[] = [];
    for await (const c of traced.chat([], { model: 'm' })) {
      chunks.push(c);
    }

    expect(chunks).toEqual([{ type: 'text_delta', text: 'ok' }]);
  });

  /**
   * A trava contra o próximo esquecimento, e a que vale por todas: rodada
   * contra os providers DE VERDADE, ela quebra se o decorator voltar a perder
   * o método — sem depender de alguém lembrar de atualizar uma lista.
   *
   * É o mesmo contrato do port dito de outro jeito: capability declarada e
   * método ausente é combinação proibida, e o decorator é parte do caminho.
   *
   * Só a direção `capability ⇒ método` é afirmada. A recíproca ("quem não
   * declara não expõe") está na prosa do port, mas `OpenAICompatibleProvider`
   * implementa `listModels` no protótipo para todos os seus filhos — então
   * NVIDIA NIM, Bitdeer e Vultr expõem o método com a capability em `false`.
   * É inofensivo para o sync, cujo guarda desiste pela capability antes de
   * olhar o método; e é divergência PRÉ-EXISTENTE, que este teste registra em
   * vez de esconder atrás de uma asserção que ninguém sustenta.
   */
  describe('capability declarada implica método presente, ATRAVÉS do decorator', () => {
    const reais: LLMProvider[] = [
      new OllamaProvider(),
      new OpenRouterProvider(),
      new NvidiaNimProvider(),
      new TogetherProvider(),
      new DeepInfraProvider(),
      new BitdeerProvider(),
      new VultrProvider(),
    ];

    for (const provider of reais) {
      it(`${provider.name}`, () => {
        const traced = new TracedLLMProvider(provider, metrics);

        if (traced.capabilities.listModels) {
          expect(typeof traced.listModels).toBe('function');
        }
        // O decorator nunca pode ACRESCENTAR o método a quem não o tinha.
        expect(traced.listModels === undefined).toBe(
          provider.listModels === undefined,
        );
      });
    }
  });
});
