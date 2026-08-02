import { describe, expect, it } from 'vitest';
import type { ServerResponse } from 'node:http';
import type { ChatStreamChunk } from '@brabo/shared';
import { OpenAICompatibleProvider } from '../../../src/infrastructure/llm/openai-compatible-provider';
import {
  OPENROUTER_BASE_URL,
  OpenRouterProvider,
  openrouterConfig,
  parseCatalogoOpenRouter,
  parseErrorFrameOpenRouter,
} from '../../../src/infrastructure/llm/openrouter-provider';
import { GptTokenizerEstimator } from '../../../src/infrastructure/tokenization/gpt-tokenizer-estimator';
import { runLLMProviderContract } from '../../contract/llm-provider.contract';
import {
  CATALOGO_ESPERADO,
  FERRAMENTA_ESPERADA,
  PEDACOS_DO_TEXTO,
  STATUS_DO_CENARIO,
  subirServidorFalso,
  type CenarioLLM,
} from '../../support/llm/fake-llm-server';

/**
 * O dialeto de fio é o mesmo da OpenAI (SSE em `/chat/completions`) — o
 * OpenRouter É compatível, essa é a premissa da base (Fase 9a/11a). O que
 * diferencia o hub são os QUIRKS testados abaixo, não o formato do stream.
 */
function dialetoOpenRouter(cenario: CenarioLLM, res: ServerResponse): void {
  const status = STATUS_DO_CENARIO[cenario];
  if (status) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'falha simulada' } }));
    return;
  }

  if (cenario === 'catalogo') {
    // Formato REAL do catálogo do OpenRouter: pricing/janela na própria
    // linha, não só `{ id }` como a OpenAI — ver `parseCatalogoOpenRouter`.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        data: CATALOGO_ESPERADO.map((id) => ({
          id,
          name: id,
          context_length: 128_000,
          pricing: { prompt: '0.0000025', completion: '0.00001' },
          supported_parameters: ['tools'],
        })),
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

runLLMProviderContract('openrouter', () => ({
  dialeto: dialetoOpenRouter,
  // A config de PRODUÇÃO apontada pro servidor falso — ver o comentário em
  // `openrouterConfig` sobre por que ela é exportada à parte pra isto.
  criar: (baseUrl) =>
    new OpenAICompatibleProvider(
      openrouterConfig(baseUrl),
      new GptTokenizerEstimator(),
    ),
  usageFallback: 'estimated',
  timeoutEnv: 'LLM_REQUEST_TIMEOUT_MS',
  temFerramentasNoPedido: (body) => Array.isArray(body.tools),
  modelo: 'openai/gpt-4o-mini',
}));

describe('OpenRouterProvider — quirks (Fase 11a)', () => {
  it('OpenRouterProvider declara capabilities.listModels e usa o base URL oficial', () => {
    const provider = new OpenRouterProvider();
    expect(provider.capabilities).toEqual({
      streaming: true,
      toolCalling: true,
      listModels: true,
    });
    expect(OPENROUTER_BASE_URL).toBe('https://openrouter.ai/api/v1');
  });

  it('cabeçalhos próprios: Authorization Bearer, HTTP-Referer e X-Title', async () => {
    let headersRecebidos: Record<string, string | string[] | undefined> = {};
    const servidor = await subirServidorFalsoComHeaders(
      dialetoOpenRouter,
      (headers) => {
        headersRecebidos = headers;
      },
    );
    const provider = new OpenAICompatibleProvider(
      openrouterConfig(servidor.baseUrl),
      new GptTokenizerEstimator(),
    );

    for await (const _ of provider.chat([{ role: 'user', content: 'oi' }], {
      model: 'openai/gpt-4o-mini',
      apiKey: 'sk-or-teste',
    })) {
      // drena
    }
    await servidor.fechar();

    expect(headersRecebidos.authorization).toBe('Bearer sk-or-teste');
    expect(headersRecebidos['http-referer']).toBeTruthy();
    expect(headersRecebidos['x-title']).toBe('Brabo');
  });

  it('hub: extrai o provider que respondeu de verdade (frame.provider), não o prefixo do id pedido', async () => {
    // Dialeto isolado: o `provider` do frame é um quirk específico deste
    // teste, não do cenário `com_usage` compartilhado com o contrato genérico.
    const servidor = await subirServidorFalso((_cenario, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(
        `data: ${JSON.stringify({ provider: 'openai', choices: [{ delta: { content: 'oi' } }] })}\n\n`,
      );
      res.write(
        `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 3 } })}\n\n`,
      );
      res.write('data: [DONE]\n\n');
      res.end();
    });

    const provider = new OpenAICompatibleProvider(
      openrouterConfig(servidor.baseUrl),
      new GptTokenizerEstimator(),
    );

    const chunks: ChatStreamChunk[] = [];
    for await (const chunk of provider.chat([{ role: 'user', content: 'oi' }], {
      model: 'openai/gpt-4o-mini',
    })) {
      chunks.push(chunk);
    }
    await servidor.fechar();

    expect(chunks.find((c) => c.type === 'usage')).toMatchObject({
      upstreamProvider: 'openai',
    });
  });
});

describe('parseCatalogoOpenRouter', () => {
  it('converte pricing USD/token (string) para micro-USD por milhão, arredondado', () => {
    const catalogo = parseCatalogoOpenRouter({
      data: [
        {
          id: 'openai/gpt-4o-mini',
          name: 'GPT-4o mini',
          context_length: 128_000,
          pricing: { prompt: '0.0000025', completion: '0.00001' },
          supported_parameters: ['tools', 'temperature'],
        },
      ],
    });

    expect(catalogo).toEqual([
      {
        name: 'openai/gpt-4o-mini',
        displayName: 'GPT-4o mini',
        contextLength: 128_000,
        supportsToolCalling: true,
        inputPricePerMillionMicros: 2_500_000,
        outputPricePerMillionMicros: 10_000_000,
      },
    ]);
  });

  it('linha sem pricing/context/nome/tools: só o essencial, sem inventar campo', () => {
    const catalogo = parseCatalogoOpenRouter({
      data: [{ id: 'algum/modelo' }],
    });

    expect(catalogo).toEqual([
      { name: 'algum/modelo', supportsToolCalling: false },
    ]);
  });

  it('linha sem id é descartada — id é o único campo obrigatório do catálogo', () => {
    const catalogo = parseCatalogoOpenRouter({
      data: [{ name: 'sem id' }, { id: '' }, { id: 'valido' }],
    });

    expect(catalogo.map((m) => m.name)).toEqual(['valido']);
  });

  it('corpo sem `data` (ou não-array) vira catálogo vazio, não exceção', () => {
    expect(parseCatalogoOpenRouter({})).toEqual([]);
    expect(parseCatalogoOpenRouter({ data: 'não é array' })).toEqual([]);
    expect(parseCatalogoOpenRouter(null)).toEqual([]);
  });
});

describe('parseErrorFrameOpenRouter', () => {
  it('sem campo `error` truthy: não é um frame de erro', () => {
    expect(parseErrorFrameOpenRouter({ choices: [] })).toBeUndefined();
    expect(parseErrorFrameOpenRouter({ error: null })).toBeUndefined();
  });

  it('código numérico: normaliza pelo status HTTP comum', () => {
    const erro = parseErrorFrameOpenRouter({
      error: { code: 429, message: 'rate limited' },
    });
    expect(erro?.code).toBe('rate_limit');
  });

  const CASOS: { codigo: string; esperado: string }[] = [
    { codigo: 'auth_error', esperado: 'auth' },
    { codigo: 'rate_limit_exceeded', esperado: 'rate_limit' },
    { codigo: 'context_length_exceeded', esperado: 'context_length' },
    { codigo: 'token_limit_reached', esperado: 'context_length' },
    { codigo: 'model_not_found', esperado: 'model_not_found' },
    { codigo: 'upstream_timeout', esperado: 'timeout' },
    { codigo: 'provider_disconnected', esperado: 'connection' },
    { codigo: 'algo_totalmente_desconhecido', esperado: 'upstream' },
  ];

  for (const { codigo, esperado } of CASOS) {
    it(`código de string "${codigo}" mapeia para "${esperado}"`, () => {
      const erro = parseErrorFrameOpenRouter({
        error: { code: codigo, message: 'msg' },
      });
      expect(erro?.code).toBe(esperado);
    });
  }

  it('erro NUNCA é engolido: código ausente ainda vira upstream, nunca undefined', () => {
    const erro = parseErrorFrameOpenRouter({ error: { message: 'sem code' } });
    expect(erro?.code).toBe('upstream');
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
