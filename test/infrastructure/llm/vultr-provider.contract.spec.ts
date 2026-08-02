import { describe, expect, it } from 'vitest';
import type { ServerResponse } from 'node:http';
import { OpenAICompatibleProvider } from '../../../src/infrastructure/llm/openai-compatible-provider';
import {
  VULTR_BASE_URL,
  VultrProvider,
  vultrConfig,
} from '../../../src/infrastructure/llm/vultr-provider';
import { GptTokenizerEstimator } from '../../../src/infrastructure/tokenization/gpt-tokenizer-estimator';
import { runLLMProviderContract } from '../../contract/llm-provider.contract';
import {
  FERRAMENTA_ESPERADA,
  PEDACOS_DO_TEXTO,
  STATUS_DO_CENARIO,
  type CenarioLLM,
} from '../../support/llm/fake-llm-server';

/**
 * O único exemplo REAL confirmado da Vultr nesta sessão (doc oficial de tool
 * calling, `finish_reason: "tool_calls"`) é dialeto OpenAI padrão puro —
 * sem campo estranho. O dialeto abaixo não hidrata nenhum quirk além disso.
 */
function dialetoVultr(cenario: CenarioLLM, res: ServerResponse): void {
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

runLLMProviderContract('vultr', () => ({
  dialeto: dialetoVultr,
  criar: (baseUrl) =>
    new OpenAICompatibleProvider(
      vultrConfig(baseUrl),
      new GptTokenizerEstimator(),
    ),
  usageFallback: 'estimated',
  timeoutEnv: 'LLM_REQUEST_TIMEOUT_MS',
  temFerramentasNoPedido: (body) => Array.isArray(body.tools),
  modelo: 'kimi-k2-instruct',
}));

describe('VultrProvider — quirks (Fase 11b)', () => {
  it('declara listModels: false — a rota que a base chama (GET /models) não tem preço na doc oficial', () => {
    const provider = new VultrProvider();
    expect(provider.capabilities).toEqual({
      streaming: true,
      toolCalling: true,
      listModels: false,
    });
    expect(VULTR_BASE_URL).toBe('https://api.vultrinference.com/v1');
  });

  it('listModels lança em vez de devolver lista vazia — RN-043 não pode ler isso como "sumiu tudo"', async () => {
    const provider = new VultrProvider();
    await expect(provider.listModels?.('chave-de-teste')).rejects.toThrow(
      /não declara a capability `listModels`/,
    );
  });
});
