import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatStreamChunk, ToolDef } from '@brabo/shared';
import { OpenAICompatibleProvider } from '../../../src/infrastructure/llm/openai-compatible-provider';
import {
  NINE_ROUTER_TOKEN_SAVER_HEADER,
  NineRouterProvider,
  nineRouterBaseUrl,
  nineRouterConfig,
} from '../../../src/infrastructure/llm/nine-router-provider';

/**
 * Smoke MANUAL do 9Router (AT-576a, ADR 0222) — a prova que a capability
 * `toolCalling` exige antes de virar `true` (ADR 0041). PULA sem
 * `NINE_ROUTER_TEST_KEY` ou `NINE_ROUTER_TEST_MODEL`.
 *
 * Decisão do dono (31/10, 9Router só com modelo GRÁTIS): use um modelo grátis
 * real, `bzl/auto:free` ou `ollama/*`. NUNCA o combo `smoke-test` nem `cc/*`/
 * `cx/*` (conta de assinatura gasta cota real). `NINE_ROUTER_BASE_URL` precisa
 * de esquema e porta, p.ex. `http://localhost:20128/v1`.
 *
 * Prova: stream, tool call, `usage`, que o `tool_result` chega INTACTO ao
 * modelo (Token Saver desligado) e qual cabeçalho da resposta diz o upstream
 * (impresso, não afirmado: ninguém mediu isso ainda).
 */
const apiKey = process.env.NINE_ROUTER_TEST_KEY;
const modelo = process.env.NINE_ROUTER_TEST_MODEL;

if (!apiKey || !modelo) {
  console.warn(
    '[smoke] NINE_ROUTER_TEST_KEY/NINE_ROUTER_TEST_MODEL não definidos — o ' +
      'smoke do 9Router foi PULADO. Use SÓ um modelo free/auto:free.',
  );
}

const FERRAMENTA: ToolDef = {
  name: 'ler_codigo',
  description:
    'Devolve o código secreto de um arquivo. Sempre chame antes de responder.',
  parameters: {
    type: 'object',
    properties: { caminho: { type: 'string' } },
    required: ['caminho'],
  },
};

// Aleatório e sem repetição: modelo erra a CONTAGEM de blocos idênticos ao
// copiar (AT-629), então o segredo não pode repetir. Ainda longo o bastante
// para um compressor de tool_result mexer nele.
const SEGREDO = `CODIGO-${Array.from({ length: 30 }, () => randomBytes(4).toString('hex')).join('-')}-FIM`;

async function coletar(
  gen: AsyncIterable<ChatStreamChunk>,
): Promise<ChatStreamChunk[]> {
  const chunks: ChatStreamChunk[] = [];
  for await (const c of gen) chunks.push(c);
  return chunks;
}

describe.skipIf(!apiKey || !modelo)(
  '9Router — aceite com chave real (AT-576a, manual)',
  () => {
    // Capabilities ligadas à força: a pergunta é "se fossem true, funcionaria?".
    const base = nineRouterConfig();
    const provider = new OpenAICompatibleProvider({
      ...base,
      capabilities: {
        ...base.capabilities,
        streaming: true,
        toolCalling: true,
      },
    });
    const opts = { model: modelo as string, apiKey, maxTokens: 256 };

    it('stream de texto devolve delta e usage', async () => {
      const chunks = await coletar(
        provider.chat([{ role: 'user', content: 'Responda só: ok' }], opts),
      );
      expect(chunks.find((c) => c.type === 'error')).toBeUndefined();
      expect(chunks.some((c) => c.type === 'text_delta')).toBe(true);
      const usage = chunks.find((c) => c.type === 'usage');
      console.log('[smoke] usage:', JSON.stringify(usage));
      expect(usage).toBeDefined();
    }, 120_000);

    it('tool call e tool_result INTACTO (Token Saver desligado)', async () => {
      const pergunta: ChatMessage[] = [
        { role: 'user', content: 'Chame ler_codigo com caminho "a.txt".' },
      ];
      const primeiro = await coletar(
        provider.chat(pergunta, { ...opts, tools: [FERRAMENTA] }),
      );
      const pedido = primeiro.find((c) => c.type === 'tool_calls');
      expect(pedido, JSON.stringify(primeiro)).toBeDefined();
      if (pedido?.type !== 'tool_calls') return;

      const segunda = await coletar(
        provider.chat(
          [
            ...pergunta,
            {
              role: 'assistant',
              content: '',
              toolCalls: pedido.toolCalls,
            },
            {
              role: 'tool',
              content: SEGREDO,
              toolCallId: pedido.toolCalls[0].id,
              name: FERRAMENTA.name,
            },
            {
              role: 'user',
              content: 'Repita o código EXATAMENTE como veio, sem mais nada.',
            },
          ],
          { ...opts, maxTokens: 512, tools: [FERRAMENTA] },
        ),
      );
      const texto = segunda
        .filter((c) => c.type === 'text_delta')
        .map((c) => (c.type === 'text_delta' ? c.text : ''))
        .join('');
      // Intacto: o modelo devolve o segredo inteiro. Se comprimido, falta pedaço.
      expect(texto.trim()).toBe(SEGREDO);
    }, 180_000);

    it('imprime os cabeçalhos da resposta (qual diz o upstream?)', async () => {
      const resp = await fetch(`${nineRouterBaseUrl()}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...base.authHeaders(apiKey),
        },
        body: JSON.stringify({
          model: modelo,
          max_tokens: 16,
          messages: [{ role: 'user', content: 'ok' }],
        }),
      });
      const cabecalhos = [...resp.headers.keys()].filter(
        (k) => k.startsWith('x-') || k.includes('9router'),
      );
      console.log('[smoke] cabeçalhos x-*:', JSON.stringify(cabecalhos));
      expect(resp.status).toBe(200);
      expect(NINE_ROUTER_TOKEN_SAVER_HEADER).toBe('x-9router-token-saver');
    }, 120_000);

    it('NineRouterProvider: "ok" sai sem os 2 000 inventados (AT-638, RN-958)', async () => {
      const chunks = await coletar(
        new NineRouterProvider().chat(
          [{ role: 'user', content: 'Responda só: ok' }],
          { model: modelo as string, apiKey, maxTokens: 16 },
        ),
      );
      const uso = chunks.find((c) => c.type === 'usage');
      console.log('[smoke] usage gravado:', JSON.stringify(uso));
      expect(uso?.type === 'usage' && uso.inputTokens).toBeLessThan(100);
    }, 120_000);
  },
);
