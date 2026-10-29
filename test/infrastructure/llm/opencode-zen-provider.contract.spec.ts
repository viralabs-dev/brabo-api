import { describe, expect, it } from 'vitest';
import type { ServerResponse } from 'node:http';
import { OpenAICompatibleProvider } from '../../../src/infrastructure/llm/openai-compatible-provider';
import {
  OPENCODE_ZEN_BASE_URL,
  OpenCodeZenProvider,
  openCodeZenConfig,
} from '../../../src/infrastructure/llm/opencode-zen-provider';
import { GptTokenizerEstimator } from '../../../src/infrastructure/tokenization/gpt-tokenizer-estimator';
import { runLLMProviderContract } from '../../contract/llm-provider.contract';
import {
  FERRAMENTA_ESPERADA,
  PEDACOS_DO_TEXTO,
  STATUS_DO_CENARIO,
  type CenarioLLM,
} from '../../support/llm/fake-llm-server';

/** Dialeto OpenAI padrão (ADR 0227): sem quirk além do SSE comum. */
function dialetoZen(cenario: CenarioLLM, res: ServerResponse): void {
  const status = STATUS_DO_CENARIO[cenario];
  if (status) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'falha simulada' } }));
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
          delta: {
            tool_calls: [{ index: 0, function: { arguments: argumentos } }],
          },
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

runLLMProviderContract('opencode-zen', () => ({
  dialeto: dialetoZen,
  posicaoDoSistemaTardio: 'fim_da_conversa',
  criar: (baseUrl) =>
    new OpenAICompatibleProvider(
      openCodeZenConfig(baseUrl),
      new GptTokenizerEstimator(),
    ),
  usageFallback: 'estimated',
  timeoutEnv: 'LLM_REQUEST_TIMEOUT_MS',
  temFerramentasNoPedido: (body) => Array.isArray(body.tools),
  modelo: 'deepseek-v4.1-flash-free',
}));

describe('OpenCodeZenProvider (AT-568, ADR 0227)', () => {
  it('capabilities: só streaming; o resto false até o smoke com chave (ADR 0041)', () => {
    expect(new OpenCodeZenProvider().capabilities).toEqual({
      streaming: true,
      toolCalling: false,
      listModels: false,
      embeddings: false,
      routingPreference: false,
      stickySession: false,
      priceCeiling: false,
      promptCaching: false,
    });
    expect(OPENCODE_ZEN_BASE_URL).toBe(
      'https://opencode.ai/inference/openai/v1',
    );
  });

  it('listModels lança em vez de devolver lista vazia — RN-043 não pode ler isso como "sumiu tudo"', async () => {
    await expect(
      new OpenCodeZenProvider().listModels?.('chave-de-teste'),
    ).rejects.toThrow(/não declara a capability `listModels`/);
  });
});
