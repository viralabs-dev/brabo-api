import { describe, expect, it } from 'vitest';
import type { ServerResponse } from 'node:http';
import { OpenAICompatibleProvider } from '../../../src/infrastructure/llm/openai-compatible-provider';
import {
  DEEPINFRA_BASE_URL,
  DeepInfraProvider,
  deepinfraConfig,
  parseCatalogoDeepInfra,
} from '../../../src/infrastructure/llm/deepinfra-provider';
import { GptTokenizerEstimator } from '../../../src/infrastructure/tokenization/gpt-tokenizer-estimator';
import { runLLMProviderContract } from '../../contract/llm-provider.contract';
import {
  CATALOGO_ESPERADO,
  FERRAMENTA_ESPERADA,
  PEDACOS_DO_TEXTO,
  STATUS_DO_CENARIO,
  type CenarioLLM,
} from '../../support/llm/fake-llm-server';

/** DeepInfra fala o dialeto OpenAI padrão de SSE, com erro `{error:{message}}`. */
function dialetoDeepInfra(cenario: CenarioLLM, res: ServerResponse): void {
  const status = STATUS_DO_CENARIO[cenario];
  if (status) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: { message: 'falha simulada', type: 'invalid_request_error' },
      }),
    );
    return;
  }

  if (cenario === 'catalogo') {
    // Formato REAL, confirmado AO VIVO nesta sessão contra
    // `GET https://api.deepinfra.com/v1/openai/models`: preço/contexto sob
    // `metadata`, e a MESMA lista mistura chat com imagem/áudio/vídeo — daí
    // o modelo de imagem no meio, pra provar que o filtro por `tags` funciona.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        object: 'list',
        data: [
          ...CATALOGO_ESPERADO.map((id) => ({
            id,
            object: 'model',
            metadata: {
              context_length: 163_840,
              pricing: { input_tokens: 0.32, output_tokens: 0.89 },
              tags: ['chat'],
            },
          })),
          {
            id: 'black-forest-labs/FLUX-1-schnell',
            object: 'model',
            metadata: {
              context_length: null,
              pricing: { per_image_unit: 0.0005 },
              tags: ['image-gen'],
            },
          },
        ],
      }),
    );
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/event-stream' });

  if (cenario === 'tool_call') {
    const argumentos = JSON.stringify(FERRAMENTA_ESPERADA.arguments);
    escrever(res, {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                function: { name: FERRAMENTA_ESPERADA.name, arguments: '' },
              },
            ],
          },
        },
      ],
    });
    escrever(res, {
      choices: [
        {
          delta: { tool_calls: [{ index: 0, function: { arguments: argumentos } }] },
        },
      ],
    });
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  escrever(res, { choices: [{ delta: { content: PEDACOS_DO_TEXTO[0] } }] });
  escrever(res, { choices: [{ delta: { content: PEDACOS_DO_TEXTO[1] } }] });

  if (cenario === 'com_usage') {
    escrever(res, {
      choices: [],
      usage: { prompt_tokens: 7, completion_tokens: 3 },
    });
  }

  res.write('data: [DONE]\n\n');
  res.end();
}

function escrever(res: ServerResponse, corpo: unknown): void {
  res.write(`data: ${JSON.stringify(corpo)}\n\n`);
}

runLLMProviderContract('deepinfra', () => ({
  dialeto: dialetoDeepInfra,
  criar: (baseUrl) =>
    new OpenAICompatibleProvider(
      deepinfraConfig(baseUrl),
      new GptTokenizerEstimator(),
    ),
  usageFallback: 'estimated',
  timeoutEnv: 'LLM_REQUEST_TIMEOUT_MS',
  temFerramentasNoPedido: (body) => Array.isArray(body.tools),
  modelo: 'deepseek-ai/DeepSeek-V3',
}));

describe('DeepInfraProvider — quirks (Fase 11b)', () => {
  it('declara listModels: true — catálogo público confirmado ao vivo com pricing', () => {
    const provider = new DeepInfraProvider();
    expect(provider.capabilities).toEqual({
      streaming: true,
      toolCalling: true,
      listModels: true,
      // Nenhum smoke com credencial provou o `/embeddings` deste provider
      // (ADR 0075) — a base sabe falar o dialeto, o provider nao declara.
      embeddings: false,
    });
    expect(DEEPINFRA_BASE_URL).toBe('https://api.deepinfra.com/v1/openai');
  });
});

describe('parseCatalogoDeepInfra', () => {
  it('converte metadata.pricing (USD/milhão) para micro-USD por milhão, só modelos tagueados "chat"', () => {
    const catalogo = parseCatalogoDeepInfra({
      data: [
        {
          id: 'deepseek-ai/DeepSeek-V3',
          metadata: {
            context_length: 163_840,
            pricing: { input_tokens: 0.32, output_tokens: 0.89 },
            tags: ['chat'],
          },
        },
      ],
    });

    expect(catalogo).toEqual([
      {
        name: 'deepseek-ai/DeepSeek-V3',
        contextLength: 163_840,
        inputPricePerMillionMicros: 320_000,
        outputPricePerMillionMicros: 890_000,
      },
    ]);
  });

  it('modelo sem a tag "chat" (imagem/áudio/vídeo) é DESCARTADO — pricing daquele shape não é por token', () => {
    const catalogo = parseCatalogoDeepInfra({
      data: [
        {
          id: 'black-forest-labs/FLUX-1-schnell',
          metadata: {
            context_length: null,
            pricing: { per_image_unit: 0.0005 },
            tags: ['image-gen'],
          },
        },
        {
          id: 'deepseek-ai/DeepSeek-V3',
          metadata: {
            pricing: { input_tokens: 0.32, output_tokens: 0.89 },
            tags: ['chat'],
          },
        },
      ],
    });

    expect(catalogo.map((m) => m.name)).toEqual(['deepseek-ai/DeepSeek-V3']);
  });

  it('sem `tags` nenhuma (ou não-array) é descartado — nunca assume "é chat" por omissão', () => {
    const catalogo = parseCatalogoDeepInfra({
      data: [
        { id: 'sem-tags', metadata: { pricing: { input_tokens: 1, output_tokens: 1 } } },
      ],
    });
    expect(catalogo).toEqual([]);
  });

  it('linha sem id é descartada, corpo sem `data` vira catálogo vazio', () => {
    expect(
      parseCatalogoDeepInfra({ data: [{ metadata: { tags: ['chat'] } }] }),
    ).toEqual([]);
    expect(parseCatalogoDeepInfra({})).toEqual([]);
    expect(parseCatalogoDeepInfra(null)).toEqual([]);
  });

  it('pricing ausente ou não-numérico dentro de um modelo "chat": campo fica ausente, não zerado', () => {
    const catalogo = parseCatalogoDeepInfra({
      data: [{ id: 'modelo-sem-preco', metadata: { tags: ['chat'] } }],
    });
    expect(catalogo).toEqual([{ name: 'modelo-sem-preco' }]);
  });
});
