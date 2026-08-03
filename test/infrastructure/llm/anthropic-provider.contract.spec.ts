import type { ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
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
    delta: { stop_reason: 'end_turn', stop_sequence: null },
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
  criar: criarProvider,
  usageFallback: 'sempre',
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
      system: string;
      messages: { role: string; content: unknown }[];
    };
    await servidor.fechar();

    // System sai do array de mensagens e vira parâmetro próprio.
    expect(pedido.system).toBe('seja breve');
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
