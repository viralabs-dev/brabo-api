import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { OpenAICompatibleProvider } from '../../../src/infrastructure/llm/openai-compatible-provider';
import {
  NINE_ROUTER_BASE_URL_PADRAO,
  NINE_ROUTER_TOKEN_SAVER_HEADER,
  NineRouterProvider,
  nineRouterBaseUrl,
  nineRouterConfig,
  parseCatalogo9Router,
} from '../../../src/infrastructure/llm/nine-router-provider';
import { LLMCredentialConnectionTesterImpl } from '../../../src/infrastructure/llm/llm-credential-connection-tester';
import fixture from '../../fixtures/nine-router/models.sintetica.json';
import { GptTokenizerEstimator } from '../../../src/infrastructure/tokenization/gpt-tokenizer-estimator';
import { runLLMProviderContract } from '../../contract/llm-provider.contract';
import {
  CATALOGO_ESPERADO,
  FERRAMENTA_ESPERADA,
  PEDACOS_DO_TEXTO,
  STATUS_DO_CENARIO,
  type CenarioLLM,
} from '../../support/llm/fake-llm-server';

/** 9Router fala o dialeto OpenAI padrão de SSE — mesma premissa da base. */
function dialeto9Router(cenario: CenarioLLM, res: ServerResponse): void {
  const status = STATUS_DO_CENARIO[cenario];
  if (status) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'falha simulada' } }));
    return;
  }

  if (cenario === 'catalogo') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        data: CATALOGO_ESPERADO.map((id) => ({ id })),
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

runLLMProviderContract('9router', () => ({
  dialeto: dialeto9Router,
  posicaoDoSistemaTardio: 'fim_da_conversa',
  criar: (baseUrl) =>
    new OpenAICompatibleProvider(
      nineRouterConfig(baseUrl),
      new GptTokenizerEstimator(),
    ),
  usageFallback: 'estimated',
  timeoutEnv: 'LLM_REQUEST_TIMEOUT_MS',
  temFerramentasNoPedido: (body) => Array.isArray(body.tools),
  modelo: 'kgw/kilo-auto/free',
}));

describe('NineRouterProvider (AT-576a, ADR 0222)', () => {
  afterEach(() => {
    delete process.env.NINE_ROUTER_BASE_URL;
  });

  it('capabilities: streaming (exigido pelo contrato) e listModels; o resto false até o smoke com chave', () => {
    expect(new NineRouterProvider().capabilities).toEqual({
      streaming: true,
      toolCalling: false,
      listModels: true,
      embeddings: false,
      routingPreference: false,
      stickySession: false,
      priceCeiling: false,
      promptCaching: false,
    });
  });

  it('URL base: padrão host.docker.internal, e NINE_ROUTER_BASE_URL manda (sem barra no fim)', () => {
    expect(nineRouterBaseUrl()).toBe(NINE_ROUTER_BASE_URL_PADRAO);
    process.env.NINE_ROUTER_BASE_URL = 'http://192.168.0.9:20128/v1/';
    expect(nineRouterBaseUrl()).toBe('http://192.168.0.9:20128/v1');
    expect(nineRouterConfig().baseUrl).toBe('http://192.168.0.9:20128/v1');
  });

  it('Token Saver desligado em toda chamada (cabeçalho junto da credencial)', () => {
    expect(nineRouterConfig().authHeaders('k')).toEqual({
      Authorization: 'Bearer k',
      [NINE_ROUTER_TOKEN_SAVER_HEADER]: 'off',
    });
  });

  it('teste de conexão: GET /models na URL do ambiente, com a chave; 401 vira falha', async () => {
    const vistos: { url?: string; auth?: string }[] = [];
    let status = 200;
    const servidor = createServer((req, res) => {
      vistos.push({ url: req.url, auth: req.headers.authorization });
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
    try {
      const porta = (servidor.address() as { port: number }).port;
      process.env.NINE_ROUTER_BASE_URL = `http://127.0.0.1:${porta}/v1`;
      const tester = new LLMCredentialConnectionTesterImpl();
      expect(tester.supports('9router')).toBe(true);
      await tester.test('9router', 'sk-abc');
      expect(vistos[0]).toMatchObject({
        url: '/v1/models',
        auth: 'Bearer sk-abc',
      });
      status = 401;
      await expect(tester.test('9router', 'ruim')).rejects.toThrow(/401/);
    } finally {
      servidor.close();
    }
  });
});

describe('parseCatalogo9Router (fixture SINTÉTICA)', () => {
  it('lê tools/reasoning/contexto de capabilities; sem preço, sem inventar', () => {
    expect(parseCatalogo9Router(fixture)).toEqual([
      {
        name: 'kgw/kilo-auto/free',
        displayName: 'Kilo Auto Free',
        contextLength: 131_072,
        supportsToolCalling: true,
        supportsReasoning: false,
      },
      {
        name: 'bzl/auto:free',
        contextLength: 200_000,
        supportsToolCalling: true,
        supportsReasoning: true,
      },
      { name: 'kimchi/modelo-sem-tools', supportsToolCalling: false },
      { name: 'mmf/mimo-auto' },
    ]);
  });

  it('corpo sem `data` vira vazio, sem exceção', () => {
    expect(parseCatalogo9Router({})).toEqual([]);
    expect(parseCatalogo9Router(null)).toEqual([]);
  });
});
