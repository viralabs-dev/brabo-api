import { describe, expect, it } from 'vitest';
import type { LLMProviderCapabilities } from '@brabo/shared';
import {
  PREFERENCIAS_DE_ROTEAMENTO,
  RoutingPreferenceNotSupportedError,
  preferenciaDoBinding,
  preferenciaEnviada,
  tetoDePreco,
  devoRetentarSemTeto,
} from '../../../src/domain/llm/routing-preference';
import { routingPreferenceEnum } from '../../../src/db/schema';
import { AnthropicProvider } from '../../../src/infrastructure/llm/anthropic-provider';
import { BitdeerProvider } from '../../../src/infrastructure/llm/bitdeer-provider';
import { DeepInfraProvider } from '../../../src/infrastructure/llm/deepinfra-provider';
import { NvidiaNimProvider } from '../../../src/infrastructure/llm/nvidia-nim-provider';
import { OllamaProvider } from '../../../src/infrastructure/llm/ollama-provider';
import { OpenAIProvider } from '../../../src/infrastructure/llm/openai-provider';
import { OpenRouterProvider } from '../../../src/infrastructure/llm/openrouter-provider';
import { TogetherProvider } from '../../../src/infrastructure/llm/together-provider';
import { NineRouterProvider } from '../../../src/infrastructure/llm/nine-router-provider';
import { VultrProvider } from '../../../src/infrastructure/llm/vultr-provider';

const BASE: LLMProviderCapabilities = {
  streaming: true,
  toolCalling: true,
  listModels: true,
  embeddings: false,
  routingPreference: false,
  stickySession: false,
  priceCeiling: false,
  promptCaching: false,
};
const HUB = {
  name: 'openrouter' as const,
  capabilities: { ...BASE, routingPreference: true },
};
const DIRETO = { name: 'openai' as const, capabilities: BASE };

describe('preferenciaDoBinding (ADR 0166, ponto 3)', () => {
  it('caminho feliz: valor pedido para provider que declara a capability é gravado', () => {
    expect(
      preferenciaDoBinding({
        pedida: 'throughput',
        gravada: null,
        provider: HUB,
      }),
    ).toBe('throughput');
  });

  it('falha: valor pedido para provider SEM a capability é recusado nomeando o provider', () => {
    expect(() =>
      preferenciaDoBinding({
        pedida: 'latency',
        gravada: null,
        provider: DIRETO,
      }),
    ).toThrow(RoutingPreferenceNotSupportedError);
    expect(() =>
      preferenciaDoBinding({
        pedida: 'latency',
        gravada: null,
        provider: DIRETO,
      }),
    ).toThrow(/"openai".*routingPreference/);
  });

  it('campo AUSENTE preserva a gravada quando o provider aceita — omitir não limpa em silêncio', () => {
    expect(
      preferenciaDoBinding({
        pedida: undefined,
        gravada: 'price',
        provider: HUB,
      }),
    ).toBe('price');
  });

  it('campo AUSENTE com provider sem a capability ZERA — nenhum binding guarda o que o provider não entende', () => {
    expect(
      preferenciaDoBinding({
        pedida: undefined,
        gravada: 'price',
        provider: DIRETO,
      }),
    ).toBeNull();
  });

  it('`null` explícito limpa, inclusive em provider sem a capability (limpar nunca é recusado)', () => {
    expect(
      preferenciaDoBinding({ pedida: null, gravada: 'price', provider: HUB }),
    ).toBeNull();
    expect(
      preferenciaDoBinding({ pedida: null, gravada: null, provider: DIRETO }),
    ).toBeNull();
  });
});

describe('preferenciaEnviada (ADR 0166, ponto 5)', () => {
  it('o que congela no metering é o que foi ao fio: com a capability, o do binding', () => {
    expect(preferenciaEnviada('throughput', HUB.capabilities)).toBe(
      'throughput',
    );
    expect(preferenciaEnviada(null, HUB.capabilities)).toBeNull();
  });

  it('sem a capability, nada foi enviado — a linha registra null mesmo com binding preenchido', () => {
    expect(preferenciaEnviada('throughput', BASE)).toBeNull();
  });
});

describe('a lista e as declarações', () => {
  it('o enum do Postgres é a MESMA lista do domínio, na mesma ordem', () => {
    expect(routingPreferenceEnum.enumValues).toEqual([
      ...PREFERENCIAS_DE_ROTEAMENTO,
    ]);
  });

  it('só o OpenRouter declara a capability — o único provado pelo smoke com credencial (AT-158)', () => {
    const providers = [
      new AnthropicProvider(),
      new BitdeerProvider(),
      new DeepInfraProvider(),
      new NvidiaNimProvider(),
      new OllamaProvider(),
      new OpenAIProvider(),
      new OpenRouterProvider(),
      new TogetherProvider(),
      new VultrProvider(),
      new NineRouterProvider(),
    ];
    expect(providers).toHaveLength(10);
    for (const provider of providers) {
      expect([provider.name, provider.capabilities.routingPreference]).toEqual([
        provider.name,
        provider.name === 'openrouter',
      ]);
    }
  });
});

describe('teto de preço (ADR 0225, RN-917)', () => {
  const PRECO = {
    inputPricePerMillionMicros: 140_000,
    outputPricePerMillionMicros: 420_000,
  };
  const comTeto = { ...BASE, priceCeiling: true };

  it('catálogo × 1,5 por ponta', () => {
    expect(tetoDePreco(PRECO, comTeto)).toEqual({
      inputPerMillionMicros: 210_000,
      outputPerMillionMicros: 630_000,
    });
  });

  it('sem a capability, ou com preço 0 em qualquer ponta, nada é enviado', () => {
    expect(tetoDePreco(PRECO, { ...BASE, priceCeiling: false })).toBeNull();
    expect(
      tetoDePreco({ ...PRECO, inputPricePerMillionMicros: 0 }, comTeto),
    ).toBeNull();
    expect(
      tetoDePreco({ ...PRECO, outputPricePerMillionMicros: 0 }, comTeto),
    ).toBeNull();
  });

  it('só repete quando a chamada ia COM teto e o erro é price_ceiling', () => {
    expect(
      devoRetentarSemTeto({ comTeto: true, errorCode: 'price_ceiling' }),
    ).toBe(true);
    expect(
      devoRetentarSemTeto({ comTeto: false, errorCode: 'price_ceiling' }),
    ).toBe(false);
    expect(
      devoRetentarSemTeto({ comTeto: true, errorCode: 'model_not_found' }),
    ).toBe(false);
  });

  it('só o OpenRouter declara a capability', () => {
    const providers = [
      new AnthropicProvider(),
      new BitdeerProvider(),
      new DeepInfraProvider(),
      new NvidiaNimProvider(),
      new OllamaProvider(),
      new OpenAIProvider(),
      new OpenRouterProvider(),
      new TogetherProvider(),
      new VultrProvider(),
      new NineRouterProvider(),
    ];
    for (const p of providers) {
      expect([p.name, p.capabilities.priceCeiling]).toEqual([
        p.name,
        p.name === 'openrouter',
      ]);
    }
  });
});
