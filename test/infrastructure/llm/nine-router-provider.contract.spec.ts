import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { openaiConfig } from '../../../src/infrastructure/llm/openai-provider';
import { openrouterConfig } from '../../../src/infrastructure/llm/openrouter-provider';
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

  it('capabilities: streaming (exigido pelo contrato) e listModels; toolCalling provado por smoke (31/10, RN-950); o resto false até o smoke com chave', () => {
    expect(new NineRouterProvider().capabilities).toEqual({
      streaming: true,
      toolCalling: true,
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

describe('NineRouterProvider: usage corrigido (AT-638, RN-958)', () => {
  afterEach(() => {
    delete process.env.NINE_ROUTER_BASE_URL;
    vi.restoreAllMocks();
  });

  /** `versao`: corpo/status de /api/version; `usage`: o frame final do stream. */
  async function usageDe(
    versao: { status: number; corpo: string } | 'lento',
    usage: Record<string, unknown>,
  ) {
    const servidor = createServer((req, res) => {
      if (req.url === '/api/version') {
        if (versao === 'lento') return; // nunca responde: estoura os 2 s
        res.writeHead(versao.status);
        res.end(versao.corpo);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      escrever(res, { choices: [{ delta: { content: 'ok' } }] });
      escrever(res, { choices: [], usage });
      res.write('data: [DONE]\n\n');
      res.end();
    });
    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
    try {
      const porta = (servidor.address() as { port: number }).port;
      process.env.NINE_ROUTER_BASE_URL = `http://127.0.0.1:${porta}/v1`;
      const chunks = [];
      for await (const c of new NineRouterProvider().chat(
        [{ role: 'user', content: 'oi' }],
        { model: 'cc/x', apiKey: 'k' },
      )) {
        chunks.push(c);
      }
      return chunks.find((c) => c.type === 'usage');
    } finally {
      servidor.closeAllConnections();
      servidor.close();
    }
  }
  const v = (currentVersion: string) => ({
    status: 200,
    corpo: JSON.stringify({ currentVersion }),
  });

  it('0.5.112: subtrai 2 000 do prompt_tokens', async () => {
    expect(
      await usageDe(v('0.5.112'), {
        prompt_tokens: 2039,
        completion_tokens: 4,
      }),
    ).toMatchObject({ inputTokens: 39, outputTokens: 4 });
  });

  it('0.5.112: piso em 0', async () => {
    expect(await usageDe(v('0.5.112'), { prompt_tokens: 1500 })).toMatchObject({
      inputTokens: 0,
    });
  });

  it('outra versão: grava como veio e avisa', async () => {
    const aviso = vi.spyOn(Logger.prototype, 'warn');
    expect(await usageDe(v('0.5.113'), { prompt_tokens: 2039 })).toMatchObject({
      inputTokens: 2039,
    });
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining('0.5.113'));
  });

  it.each([
    ['404', { status: 404, corpo: '' }],
    ['corpo inválido', { status: 200, corpo: 'nao-json' }],
    ['sem currentVersion', { status: 200, corpo: '{}' }],
  ] as const)(
    '/api/version %s: não subtrai nem derruba o turno',
    async (_n, ver) => {
      expect(await usageDe(ver, { prompt_tokens: 2039 })).toMatchObject({
        inputTokens: 2039,
      });
    },
  );

  it('/api/version lento: estoura em 2 s, não subtrai', async () => {
    expect(await usageDe('lento', { prompt_tokens: 2039 })).toMatchObject({
      inputTokens: 2039,
    });
  }, 10_000);

  it('cached_tokens do topo vira cachedInputTokens; ausente continua ausente', async () => {
    const com = await usageDe(v('0.5.112'), {
      prompt_tokens: 3000,
      cached_tokens: 1720,
    });
    expect(com).toMatchObject({ cachedInputTokens: 1720 });
    const sem = await usageDe(v('0.5.112'), { prompt_tokens: 3000 });
    expect(sem).not.toHaveProperty('cachedInputTokens');
  });

  it('outros providers não configuram o hook (nada muda)', () => {
    expect(openaiConfig().normalizarUsage).toBeUndefined();
    expect(openrouterConfig().normalizarUsage).toBeUndefined();
  });
});
