import { describe, expect, it } from 'vitest';
import type { ServerResponse } from 'node:http';
import { OpenAICompatibleProvider } from '../../../src/infrastructure/llm/openai-compatible-provider';
import {
  NVIDIA_NIM_BASE_URL,
  NvidiaNimProvider,
  nvidiaNimConfig,
} from '../../../src/infrastructure/llm/nvidia-nim-provider';
import { GptTokenizerEstimator } from '../../../src/infrastructure/tokenization/gpt-tokenizer-estimator';
import { runLLMProviderContract } from '../../contract/llm-provider.contract';
import {
  FERRAMENTA_ESPERADA,
  PEDACOS_DO_TEXTO,
  STATUS_DO_CENARIO,
  type CenarioLLM,
} from '../../support/llm/fake-llm-server';

/**
 * NIM (hospedado) fala `/chat/completions` no dialeto OpenAI padrão — sem
 * campo de hub, sem catálogo (`listModels: false`, ver `nvidiaNimConfig`), e
 * sem confirmação de `stream_options.include_usage` para o endpoint
 * hospedado — por isso o cenário `catalogo` nem é exercitado aqui, e o
 * dialeto nunca precisa simular usage vindo do servidor além do que o
 * cenário `com_usage` compartilhado já cobre.
 */
function dialetoNvidiaNim(cenario: CenarioLLM, res: ServerResponse): void {
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

runLLMProviderContract('nvidia-nim', () => ({
  dialeto: dialetoNvidiaNim,
  criar: (baseUrl) =>
    new OpenAICompatibleProvider(
      nvidiaNimConfig(baseUrl),
      new GptTokenizerEstimator(),
    ),
  usageFallback: 'estimated',
  timeoutEnv: 'LLM_REQUEST_TIMEOUT_MS',
  temFerramentasNoPedido: (body) => Array.isArray(body.tools),
  modelo: 'meta/llama-3.1-70b-instruct',
}));

describe('NvidiaNimProvider — quirks (Fase 11b)', () => {
  it('declara listModels: false — catálogo hospedado não tem preço confirmado em doc nenhuma', () => {
    const provider = new NvidiaNimProvider();
    expect(provider.capabilities).toEqual({
      streaming: true,
      toolCalling: true,
      listModels: false,
      // Nenhum smoke com credencial provou o `/embeddings` deste provider
      // (ADR 0075) — a base sabe falar o dialeto, o provider nao declara.
      embeddings: false,
    });
    expect(NVIDIA_NIM_BASE_URL).toBe('https://integrate.api.nvidia.com/v1');
  });

  it('listModels lança em vez de devolver lista vazia — RN-043 não pode ler isso como "sumiu tudo"', async () => {
    const provider = new NvidiaNimProvider();
    await expect(provider.listModels?.('nvapi-teste')).rejects.toThrow(
      /não declara a capability `listModels`/,
    );
  });

  it('Authorization Bearer vai no cabeçalho, sem header próprio nenhum (diferente do hub OpenRouter)', async () => {
    let headersRecebidos: Record<string, string | string[] | undefined> = {};
    const servidor = await subirServidorFalsoComHeaders(
      dialetoNvidiaNim,
      (headers) => {
        headersRecebidos = headers;
      },
    );
    const provider = new OpenAICompatibleProvider(
      nvidiaNimConfig(servidor.baseUrl),
      new GptTokenizerEstimator(),
    );

    for await (const _ of provider.chat([{ role: 'user', content: 'oi' }], {
      model: 'meta/llama-3.2-3b-instruct',
      apiKey: 'nvapi-abc123',
    })) {
      // drena
    }
    await servidor.fechar();

    expect(headersRecebidos.authorization).toBe('Bearer nvapi-abc123');
    // Diferente do OpenRouter: nenhum `HTTP-Referer`/`X-Title` — doc oficial
    // não menciona header próprio nenhum pra NIM.
    expect(headersRecebidos['http-referer']).toBeUndefined();
    expect(headersRecebidos['x-title']).toBeUndefined();
  });
});

/** Igual a `subirServidorFalso`, mas também expõe os headers do último pedido. */
async function subirServidorFalsoComHeaders(
  dialeto: (cenario: CenarioLLM, res: ServerResponse) => void,
  onHeaders: (headers: Record<string, string | string[] | undefined>) => void,
) {
  const { createServer } = await import('node:http');
  let cenario: CenarioLLM = 'stream_ok';

  const server = createServer((req, res) => {
    onHeaders(req.headers);
    const pedacos: Buffer[] = [];
    req.on('data', (p: Buffer) => pedacos.push(p));
    req.on('end', () => dialeto(cenario, res));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    usar: (novo: CenarioLLM) => {
      cenario = novo;
    },
    fechar: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
