import { describe, expect, it } from 'vitest';
import type { ChatStreamChunk, ToolDef } from '@brabo/shared';
import { OpenAICompatibleProvider } from '../../../src/infrastructure/llm/openai-compatible-provider';
import { openCodeZenConfig } from '../../../src/infrastructure/llm/opencode-zen-provider';

/**
 * Smoke MANUAL do OpenCode Zen (AT-568, ADR 0227) — a prova que `toolCalling`
 * e `streamOptionsIncludeUsage` exigem antes de virarem `true` (ADR 0041).
 * PULA sem `OPENCODE_ZEN_TEST_KEY`. Só modelos `-free` (custo US$ 0).
 * Resultado em 29/10/2026: 429 `FreeUsageLimitError` (grátis só vale no cliente OpenCode).
 *
 * Prova: stream de texto; tool call em `deepseek-v4.1-flash-free` e
 * `glm-5.3-flash-free`; `usage` no stream COM `stream_options` ligado.
 */
const apiKey = process.env.OPENCODE_ZEN_TEST_KEY;

if (!apiKey) {
  console.warn(
    '[smoke] OPENCODE_ZEN_TEST_KEY não definido — o smoke do OpenCode Zen foi PULADO.',
  );
}

const MODELOS = ['deepseek-v4.1-flash-free', 'glm-5.3-flash-free'] as const;

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

async function coletar(
  gen: AsyncIterable<ChatStreamChunk>,
): Promise<ChatStreamChunk[]> {
  const chunks: ChatStreamChunk[] = [];
  for await (const c of gen) chunks.push(c);
  return chunks;
}

describe.skipIf(!apiKey)(
  'OpenCode Zen — aceite com chave real (manual)',
  () => {
    // Capabilities e flags ligadas à força: a pergunta é "se fossem true, funcionaria?".
    const base = openCodeZenConfig();
    const provider = new OpenAICompatibleProvider({
      ...base,
      capabilities: { ...base.capabilities, toolCalling: true },
      flags: { ...base.flags, streamOptionsIncludeUsage: true },
    });

    it.each(MODELOS)(
      'stream de texto com usage (%s)',
      async (model) => {
        const chunks = await coletar(
          provider.chat([{ role: 'user', content: 'Responda só: ok' }], {
            model,
            apiKey,
            maxTokens: 256,
          }),
        );
        expect(chunks.find((c) => c.type === 'error')).toBeUndefined();
        expect(chunks.some((c) => c.type === 'text_delta')).toBe(true);
        const usage = chunks.find((c) => c.type === 'usage');
        console.log(`[smoke] ${model} usage:`, JSON.stringify(usage));
        expect(usage).toBeDefined();
      },
      120_000,
    );

    it.each(MODELOS)(
      'tool call (%s)',
      async (model) => {
        const chunks = await coletar(
          provider.chat(
            [
              {
                role: 'user',
                content: 'Chame ler_codigo com caminho "a.txt".',
              },
            ],
            { model, apiKey, maxTokens: 256, tools: [FERRAMENTA] },
          ),
        );
        const pedido = chunks.find((c) => c.type === 'tool_calls');
        expect(pedido, JSON.stringify(chunks)).toBeDefined();
        if (pedido?.type === 'tool_calls') {
          expect(pedido.toolCalls[0].name).toBe(FERRAMENTA.name);
        }
      },
      180_000,
    );
  },
);
