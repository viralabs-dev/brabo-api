import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ChatStreamChunk } from '@brabo/shared';
import {
  AnthropicProvider,
  pensamentoAdaptativo,
} from '../../../src/infrastructure/llm/anthropic-provider';
import { OpenAICompatibleProvider } from '../../../src/infrastructure/llm/openai-compatible-provider';
import { openaiConfig } from '../../../src/infrastructure/llm/openai-provider';
import { OpenRouterProvider } from '../../../src/infrastructure/llm/openrouter-provider';
import { OllamaProvider } from '../../../src/infrastructure/llm/ollama-provider';

// AT-676 (ADR 0249, RN-993): o TEXTO do raciocínio vira chunk próprio.
interface Corpo {
  thinking?: unknown;
  max_tokens?: number;
  messages: { content: unknown[] }[];
}
type ToolCalls = Extract<ChatStreamChunk, { type: 'tool_calls' }>;
let servidor: Server | undefined;
afterEach(() => {
  servidor?.closeAllConnections();
  servidor?.close();
});

const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
const ev = (t: string, o: unknown) =>
  `event: ${t}\ndata: ${JSON.stringify(o)}\n\n`;

async function coletar(it: AsyncIterable<ChatStreamChunk>) {
  const out: ChatStreamChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

function porta(): number {
  return (servidor!.address() as AddressInfo).port;
}

async function subirOpenAi(delta: unknown) {
  servidor = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(frame({ id: 'g', choices: [{ delta }] }));
    res.write(frame({ id: 'g', choices: [{ delta: { content: 'ok' } }] }));
    res.end(
      frame({
        id: 'g',
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }) + 'data: [DONE]\n\n',
    );
  });
  await new Promise<void>((r) => servidor!.listen(0, r));
  return new OpenAICompatibleProvider(
    openaiConfig(`http://127.0.0.1:${porta()}`),
  );
}

describe('texto do raciocínio nos providers OpenAI-compatíveis', () => {
  it.each([
    ['reasoning (OpenRouter)', { reasoning: 'pensando' }],
    ['reasoning_content (DeepSeek/vLLM)', { reasoning_content: 'pensando' }],
  ])('%s vira chunk e não vai ao content', async (_n, delta) => {
    const p = await subirOpenAi(delta);
    const chunks = await coletar(
      p.chat([{ role: 'user', content: 'x' }], { model: 'm' }),
    );
    expect(chunks.filter((c) => c.type === 'reasoning')).toEqual([
      { type: 'reasoning', text: 'pensando' },
    ]);
    const texto = chunks
      .map((c) => (c.type === 'text_delta' ? c.text : ''))
      .join('');
    expect(texto).toBe('ok');
  });
});

describe('Anthropic: thinking', () => {
  it('thinking_delta vira chunk; blocos voltam no laço e no corpo seguinte', async () => {
    const corpos: Corpo[] = [];
    servidor = createServer((req, res) => {
      let b = '';
      req.on('data', (d) => (b += d));
      req.on('end', () => {
        corpos.push(JSON.parse(b) as Corpo);
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(
          ev('message_start', {
            type: 'message_start',
            message: {
              id: 'm',
              type: 'message',
              role: 'assistant',
              model: 'c',
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 1, output_tokens: 0 },
            },
          }),
        );
        res.write(
          ev('content_block_start', {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'thinking', thinking: '', signature: '' },
          }),
        );
        res.write(
          ev('content_block_delta', {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'thinking_delta', thinking: 'hmm' },
          }),
        );
        res.write(
          ev('content_block_delta', {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'signature_delta', signature: 'SIG' },
          }),
        );
        res.write(
          ev('content_block_stop', { type: 'content_block_stop', index: 0 }),
        );
        res.write(
          ev('content_block_start', {
            type: 'content_block_start',
            index: 1,
            content_block: { type: 'tool_use', id: 't1', name: 'f', input: {} },
          }),
        );
        res.write(
          ev('content_block_delta', {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'input_json_delta', partial_json: '{}' },
          }),
        );
        res.write(
          ev('content_block_stop', { type: 'content_block_stop', index: 1 }),
        );
        res.write(
          ev('message_delta', {
            type: 'message_delta',
            delta: { stop_reason: 'tool_use', stop_sequence: null },
            usage: { output_tokens: 3 },
          }),
        );
        res.end(ev('message_stop', { type: 'message_stop' }));
      });
    });
    await new Promise<void>((r) => servidor!.listen(0, r));
    const p = new AnthropicProvider({
      baseURL: `http://127.0.0.1:${porta()}`,
      maxRetries: 0,
    });
    const chunks = await coletar(
      p.chat([{ role: 'user', content: 'x' }], {
        model: 'claude-haiku-4-5',
        apiKey: 'k',
        reasoning: true,
        reasoningBudget: 2000,
        tools: [
          { name: 'f', description: 'd', parameters: { type: 'object' } },
        ],
      }),
    );
    expect(corpos[0].thinking).toEqual({
      type: 'enabled',
      budget_tokens: 2000,
    });
    expect(chunks.filter((c) => c.type === 'reasoning')).toEqual([
      { type: 'reasoning', text: 'hmm' },
    ]);
    const tc = chunks.find((c) => c.type === 'tool_calls') as ToolCalls;
    expect(tc.thinkingBlocks).toEqual([
      { type: 'thinking', thinking: 'hmm', signature: 'SIG' },
    ]);

    // 2ª volta: o engine devolve os blocos no turno assistant.
    await coletar(
      p.chat(
        [
          { role: 'user', content: 'x' },
          {
            role: 'assistant',
            content: '',
            toolCalls: tc.toolCalls,
            thinkingBlocks: tc.thinkingBlocks,
          },
          { role: 'tool', content: 'r', toolCallId: 't1' },
        ],
        { model: 'c', apiKey: 'k', reasoning: true },
      ),
    );
    const assistente = corpos[1].messages[1];
    expect(assistente.content[0]).toEqual({
      type: 'thinking',
      thinking: 'hmm',
      signature: 'SIG',
    });
    expect(assistente.content[1]).toMatchObject({ type: 'tool_use' });
  });

  it('sem reasoning, não manda thinking', async () => {
    let corpo: Corpo | undefined;
    servidor = createServer((req, res) => {
      let b = '';
      req.on('data', (d) => (b += d));
      req.on('end', () => {
        corpo = JSON.parse(b) as Corpo;
        res.writeHead(500);
        res.end('{}');
      });
    });
    await new Promise<void>((r) => servidor!.listen(0, r));
    const p = new AnthropicProvider({
      baseURL: `http://127.0.0.1:${porta()}`,
      maxRetries: 0,
    });
    await coletar(
      p.chat([{ role: 'user', content: 'x' }], { model: 'c', apiKey: 'k' }),
    );
    expect(corpo?.thinking).toBeUndefined();
    expect(corpo?.max_tokens).toBe(4096);
  });
});

describe('Anthropic: thinking por geração do modelo (AT-676)', () => {
  async function corpoEnviado(opcoes: object): Promise<Corpo | undefined> {
    let corpo: Corpo | undefined;
    servidor = createServer((req, res) => {
      let b = '';
      req.on('data', (d) => (b += d));
      req.on('end', () => {
        corpo = JSON.parse(b) as Corpo;
        res.writeHead(500);
        res.end('{}');
      });
    });
    await new Promise<void>((r) => servidor!.listen(0, r));
    const p = new AnthropicProvider({
      baseURL: `http://127.0.0.1:${porta()}`,
      maxRetries: 0,
    });
    await coletar(
      p.chat([{ role: 'user', content: 'x' }], {
        apiKey: 'k',
        ...opcoes,
      } as never),
    );
    return corpo;
  }

  it('modelo atual: adaptive + summarized, sem budget_tokens', async () => {
    const c = await corpoEnviado({
      model: 'claude-sonnet-5-5',
      reasoning: true,
    });
    expect(c?.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(c?.max_tokens).toBe(4096);
  });

  it('modelo antigo: enabled + budget_tokens', async () => {
    const c = await corpoEnviado({
      model: 'claude-haiku-4-5',
      reasoning: true,
    });
    expect(c?.thinking).toEqual({ type: 'enabled', budget_tokens: 2048 });
  });

  it('reasoningOff não manda thinking, nem no modelo atual', async () => {
    const c = await corpoEnviado({
      model: 'claude-sonnet-5-5',
      reasoning: true,
      reasoningOff: true,
    });
    expect(c?.thinking).toBeUndefined();
  });

  it.each([
    ['claude-opus-4-6', true],
    ['claude-sonnet-5-5', true],
    ['claude-sonnet-4-5-20250929', false],
    ['claude-opus-4-1-20250805', false],
    ['claude-3-7-sonnet', false],
  ])('pensamentoAdaptativo(%s) = %s', (m, esperado) => {
    expect(pensamentoAdaptativo(m)).toBe(esperado);
  });
});

describe('capability reasoningText', () => {
  it('é false em todos até haver smoke', () => {
    for (const p of [
      new AnthropicProvider(),
      new OpenRouterProvider(),
      new OllamaProvider(),
    ]) {
      expect(p.capabilities.reasoningText).toBe(false);
    }
  });
});
