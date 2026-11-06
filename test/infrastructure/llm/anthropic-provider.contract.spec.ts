import type { ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatStreamChunk } from '@brabo/shared';
import { AnthropicProvider } from '../../../src/infrastructure/llm/anthropic-provider';
import { runLLMProviderContract } from '../../contract/llm-provider.contract';
import {
  CATALOGO_ESPERADO,
  FERRAMENTA_ESPERADA,
  PEDACOS_DO_TEXTO,
  STATUS_DO_CENARIO,
  USAGE_ESPERADO,
  subirServidorFalso,
  type CenarioLLM,
} from '../../support/llm/fake-llm-server';

function evento(res: ServerResponse, tipo: string, corpo: unknown): void {
  res.write(`event: ${tipo}\ndata: ${JSON.stringify(corpo)}\n\n`);
}

/** SSE do `/v1/messages` do Anthropic: eventos NOMEADOS, não só `data:`. */
function dialetoAnthropic(cenario: CenarioLLM, res: ServerResponse): void {
  const status = STATUS_DO_CENARIO[cenario];
  if (status) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        type: 'error',
        error: {
          type: status === 413 ? 'request_too_large' : 'api_error',
          message: 'falha simulada',
        },
      }),
    );
    return;
  }

  // O catálogo é JSON comum, não SSE: `GET /v1/models` devolve
  // `{ data: [...], has_more, first_id, last_id }`. `has_more: false` fecha a
  // auto-paginação do SDK numa página só.
  if (cenario === 'catalogo') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        data: CATALOGO_ESPERADO.map((id) => ({
          id,
          type: 'model',
          display_name: id,
          created_at: '2026-08-02T00:00:00Z',
          max_input_tokens: 200_000,
          max_tokens: 64_000,
        })),
        first_id: CATALOGO_ESPERADO[0],
        last_id: CATALOGO_ESPERADO[CATALOGO_ESPERADO.length - 1],
        has_more: false,
      }),
    );
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/event-stream' });

  // `usage` é OBRIGATÓRIO no `message_start` — não existe cenário "sem usage"
  // neste dialeto, e por isso o harness declara `usageFallback: 'sempre'`.
  evento(res, 'message_start', {
    type: 'message_start',
    message: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: cenario === 'com_usage' ? USAGE_ESPERADO.inputTokens : 0,
        output_tokens: 0,
      },
    },
  });

  if (cenario === 'tool_call') {
    evento(res, 'content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'tool_use',
        id: 'toolu_1',
        name: FERRAMENTA_ESPERADA.name,
        input: {},
      },
    });

    // `input_json_delta`: os argumentos chegam como pedaços de string JSON.
    const argumentos = JSON.stringify(FERRAMENTA_ESPERADA.arguments);
    evento(res, 'content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: argumentos.slice(0, 6) },
    });
    evento(res, 'content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: argumentos.slice(6) },
    });
    evento(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
    fechar(res, cenario);
    return;
  }

  evento(res, 'content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  });
  evento(res, 'content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: PEDACOS_DO_TEXTO[0] },
  });

  // Frame partido entre dois writes: o buffer precisa costurar.
  const segundo = `event: content_block_delta\ndata: ${JSON.stringify({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: PEDACOS_DO_TEXTO[1] },
  })}\n\n`;
  res.write(segundo.slice(0, 30));
  res.write(segundo.slice(30));

  evento(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
  fechar(res, cenario);
}

function fechar(res: ServerResponse, cenario: CenarioLLM): void {
  evento(res, 'message_delta', {
    type: 'message_delta',
    delta: {
      stop_reason: cenario === 'cortado' ? 'max_tokens' : 'end_turn',
      stop_sequence: null,
    },
    usage: {
      output_tokens: cenario === 'com_usage' ? USAGE_ESPERADO.outputTokens : 0,
    },
  });
  evento(res, 'message_stop', { type: 'message_stop' });
  res.end();
}

function criarProvider(baseUrl: string) {
  // `maxRetries: 0` porque o SDK repete 429 e 5xx sozinho — o teste de rate
  // limit viraria vários segundos e esconderia qual resposta foi classificada.
  return new AnthropicProvider({ baseURL: baseUrl, maxRetries: 0 });
}

runLLMProviderContract('anthropic', () => ({
  dialeto: dialetoAnthropic,
  posicaoDoSistemaTardio: 'fim_do_ultimo_user',
  criar: criarProvider,
  usageFallback: 'sempre',
  sinalizaCorte: true,
  timeoutEnv: 'LLM_REQUEST_TIMEOUT_MS',
  temFerramentasNoPedido: (body) => Array.isArray(body.tools),
  modelo: 'claude-sonnet-5',
}));

describe('AnthropicProvider — particularidades do dialeto', () => {
  it('resultado de ferramenta vira bloco tool_result num turno de user', async () => {
    const servidor = await subirServidorFalso(dialetoAnthropic);
    const provider = criarProvider(servidor.baseUrl);

    for await (const _ of provider.chat(
      [
        { role: 'system', content: 'seja breve' },
        { role: 'user', content: 'leia o readme' },
        {
          role: 'assistant',
          content: 'vou ler',
          toolCalls: [
            { id: 'toolu_1', name: 'ler_arquivo', arguments: { caminho: 'a' } },
          ],
        },
        { role: 'tool', content: 'conteudo', toolCallId: 'toolu_1' },
        // Segunda ferramenta na mesma rodada: precisa cair no MESMO turno.
        { role: 'tool', content: 'outro', toolCallId: 'toolu_2' },
      ],
      { model: 'claude-sonnet-5', apiKey: 'k' },
    )) {
      // drena
    }

    const pedido = servidor.ultimoPedido() as {
      system: { text: string }[];
      messages: { role: string; content: unknown }[];
    };
    await servidor.fechar();

    // System sai do array de mensagens e vira parâmetro próprio.
    expect(pedido.system.map((b) => b.text)).toEqual(['seja breve']);
    expect(pedido.messages).toHaveLength(3);

    expect(pedido.messages[1]).toMatchObject({
      role: 'assistant',
      content: [
        { type: 'text', text: 'vou ler' },
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'ler_arquivo',
          input: { caminho: 'a' },
        },
      ],
    });

    // Os dois resultados no MESMO turno de user — o Anthropic recusa
    // `tool_result` espalhado em turnos diferentes.
    expect(pedido.messages[2]).toMatchObject({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_1', content: 'conteudo' },
        { type: 'tool_result', tool_use_id: 'toolu_2', content: 'outro' },
      ],
    });
  });
});

/** Servidor falso cujo `usage` leva as parcelas de cache (RN-1008). */
function dialetoComCache(usage: Record<string, number>) {
  return (_cenario: CenarioLLM, res: ServerResponse) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    evento(res, 'message_start', {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'm',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { output_tokens: 0, ...usage },
      },
    });
    evento(res, 'content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    });
    evento(res, 'content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'ok' },
    });
    evento(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
    evento(res, 'message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: usage.output_tokens ?? 1_000 },
    });
    evento(res, 'message_stop', { type: 'message_stop' });
    res.end();
  };
}

async function chamar(
  usage: Record<string, number>,
  mensagens: ChatMessage[],
  modelo = 'claude-sonnet-5-5',
) {
  const servidor = await subirServidorFalso(dialetoComCache(usage));
  const chunks: ChatStreamChunk[] = [];
  for await (const c of criarProvider(servidor.baseUrl).chat(mensagens, {
    model: modelo,
    apiKey: 'k',
  })) {
    chunks.push(c);
  }
  const pedido = servidor.ultimoPedido() as {
    system?: { type: string; text: string; cache_control?: unknown }[];
    messages: { role: string; content: unknown }[];
  };
  await servidor.fechar();
  const uso = chunks.find((c) => c.type === 'usage');
  return { pedido, uso: uso?.type === 'usage' ? uso : undefined };
}

const EFEMERO = { type: 'ephemeral' };

describe('AnthropicProvider — prompt caching (RN-1008)', () => {
  const conversa: ChatMessage[] = [
    { role: 'system', content: 'instrucoes' },
    { role: 'system', content: 'mais instrucoes' },
    { role: 'user', content: 'primeira' },
    { role: 'assistant', content: 'resposta' },
    { role: 'user', content: 'segunda' },
    { role: 'system', content: 'cauda do turno' },
  ];

  it('(a) RN-1015: system só com o prefixo (ponto); a cauda vai no fim do último user, depois do ponto', async () => {
    const { pedido } = await chamar({ input_tokens: 5 }, conversa);
    expect(pedido.system).toEqual([
      {
        type: 'text',
        text: 'instrucoes\n\nmais instrucoes',
        cache_control: EFEMERO,
      },
    ]);
    expect(pedido.messages.at(-1)?.content).toEqual([
      { type: 'text', text: 'segunda', cache_control: EFEMERO },
      { type: 'text', text: 'cauda do turno' },
    ]);
  });

  it('(a2) RN-1015: cauda depois de tool_result fica no mesmo user; sem user no fim, volta ao system sem ponto', async () => {
    const { pedido } = await chamar({ input_tokens: 5 }, [
      { role: 'system', content: 'instrucoes' },
      { role: 'user', content: 'x' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 't1', name: 'f', arguments: {} }],
      },
      { role: 'tool', content: 'a', toolCallId: 't1' },
      { role: 'system', content: 'Escreva tudo em pt-BR' },
    ]);
    expect(pedido.system).toHaveLength(1);
    expect(pedido.messages.at(-1)?.content).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 't1',
        content: 'a',
        cache_control: EFEMERO,
      },
      { type: 'text', text: 'Escreva tudo em pt-BR' },
    ]);
    const { pedido: p2 } = await chamar({ input_tokens: 5 }, [
      { role: 'system', content: 'instrucoes' },
      { role: 'user', content: 'x' },
      { role: 'assistant', content: 'y' },
      { role: 'system', content: 'cauda' },
    ]);
    expect(p2.system?.at(-1)).toEqual({ type: 'text', text: 'cauda' });
  });

  it('(b) um ponto no último bloco da última e da penúltima user; o assistant fica intacto', async () => {
    const { pedido } = await chamar({ input_tokens: 5 }, conversa);
    expect(pedido.messages).toEqual([
      {
        role: 'user',
        content: [{ type: 'text', text: 'primeira', cache_control: EFEMERO }],
      },
      { role: 'assistant', content: 'resposta' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'segunda', cache_control: EFEMERO },
          { type: 'text', text: 'cauda do turno' },
        ],
      },
    ]);
    // resultado de ferramenta também é turno user: o ponto vai no último bloco
    const { pedido: p2 } = await chamar({ input_tokens: 5 }, [
      { role: 'user', content: 'x' },
      { role: 'tool', content: 'a', toolCallId: 't1' },
      { role: 'tool', content: 'b', toolCallId: 't2' },
    ]);
    expect(p2.messages[1].content).toEqual([
      { type: 'tool_result', tool_use_id: 't1', content: 'a' },
      {
        type: 'tool_result',
        tool_use_id: 't2',
        content: 'b',
        cache_control: EFEMERO,
      },
    ]);
  });

  it('(b2) RN-1014: 2º ponto na penúltima user; no máximo 4 pontos por pedido', async () => {
    const { pedido } = await chamar({ input_tokens: 5 }, [
      { role: 'system', content: 'instrucoes' },
      { role: 'user', content: 'x' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 't1', name: 'f', arguments: {} }],
      },
      { role: 'tool', content: 'a', toolCallId: 't1' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 't2', name: 'f', arguments: {} }],
      },
      { role: 'tool', content: 'b', toolCallId: 't2' },
    ]);
    const pontos = (v: unknown): number =>
      JSON.stringify(v).split('"cache_control"').length - 1;
    // user "x" (1ª) fica sem ponto; as duas últimas (tool_result) levam um cada
    expect(pontos(pedido.messages[0])).toBe(0);
    expect(pontos(pedido.messages[2])).toBe(1);
    expect(pontos(pedido.messages[4])).toBe(1);
    expect(pontos(pedido.system) + pontos(pedido.messages)).toBeLessThanOrEqual(
      4,
    );
  });

  it('(c) usage soma input + leitura + escrita; cachedInputTokens = leitura; sem campos, ausente', async () => {
    const { uso } = await chamar(
      {
        input_tokens: 10,
        cache_read_input_tokens: 700,
        cache_creation_input_tokens: 90,
      },
      conversa,
    );
    expect(uso).toMatchObject({ inputTokens: 800, cachedInputTokens: 700 });

    const { uso: sem } = await chamar({ input_tokens: 10 }, conversa);
    expect(sem?.inputTokens).toBe(10);
    expect(sem).not.toHaveProperty('cachedInputTokens');
    expect(sem).not.toHaveProperty('costMicros');
  });

  it('(d) custo pelas 4 parcelas × tabela do fabricante; fora da tabela não emite', async () => {
    const parcelas = {
      input_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    };
    // Sonnet 5.5: 2 / 10 por 1M => 2 + 0,2 + 2,5 + 10 = US$ 14,70
    const { uso } = await chamar(parcelas, conversa, 'claude-sonnet-5-5');
    expect(uso).toMatchObject({ costMicros: 14_700_000 });
    // Opus 5.5: 4 / 20 por 1M, leitura 0,05x => 4 + 0,2 + 5 + 20 = US$ 29,20
    const { uso: opus } = await chamar(parcelas, conversa, 'claude-opus-5-5');
    expect(opus).toMatchObject({ costMicros: 29_200_000 });

    const { uso: fora } = await chamar(
      parcelas,
      conversa,
      'claude-desconhecido-9',
    );
    expect(fora?.inputTokens).toBe(3_000_000);
    expect(fora).not.toHaveProperty('costMicros');
  });

  it('declara promptCaching', () => {
    expect(new AnthropicProvider().capabilities.promptCaching).toBe(true);
  });
});
