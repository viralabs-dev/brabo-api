import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { OllamaProvider } from '../../../src/infrastructure/llm/ollama-provider';
import type { ChatStreamChunk } from '@brabo/shared';

/**
 * Testes do TRANSPORTE do provider (reescrito de `fetch` pra `node:http` no
 * ADR 0020, pra que o timeout deixe de ser os 300s fixos do undici). Sobem um
 * Ollama falso de verdade em vez de mockar `fetch`: o que está sob teste é
 * justamente o comportamento de socket.
 */
describe('OllamaProvider (transporte)', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
    delete process.env.OLLAMA_REQUEST_TIMEOUT_MS;
  });

  async function subir(
    handler: Parameters<typeof createServer>[1],
  ): Promise<string> {
    server = createServer(handler);
    await new Promise<void>((resolve) =>
      server!.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  async function coletar(host: string): Promise<ChatStreamChunk[]> {
    const chunks: ChatStreamChunk[] = [];
    const provider = new OllamaProvider();
    for await (const chunk of provider.chat([{ role: 'user', content: 'oi' }], {
      model: 'qwen2.5-coder:7b',
      host,
    })) {
      chunks.push(chunk);
    }
    return chunks;
  }

  it('stream NDJSON: emite deltas de texto e o usage final', async () => {
    const host = await subir((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(JSON.stringify({ message: { content: 'oi' } }) + '\n');
      // Linha partida entre dois chunks: o buffer precisa costurar.
      res.write('{"message":{"content":" mun');
      res.write('do"}}\n');
      res.write(
        JSON.stringify({ done: true, prompt_eval_count: 7, eval_count: 3 }) +
          '\n',
      );
      res.end();
    });

    const chunks = await coletar(host);

    expect(chunks.filter((c) => c.type === 'text_delta')).toEqual([
      { type: 'text_delta', text: 'oi' },
      { type: 'text_delta', text: ' mundo' },
    ]);
    expect(chunks.at(-1)).toEqual({
      type: 'usage',
      inputTokens: 7,
      outputTokens: 3,
      estimated: false,
    });
  });

  it('servidor mudo: estoura o teto configurado em vez de pendurar', async () => {
    // O caso real: o Ollama enfileira a requisição de um agente atrás da de
    // outro e não manda nem os headers. Antes disto o `fetch` desistia aos
    // 300s fixos do undici com um opaco "fetch failed".
    process.env.OLLAMA_REQUEST_TIMEOUT_MS = '150';

    const host = await subir(() => {
      // Nunca responde — nem headers.
    });

    const chunks = await coletar(host);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ type: 'error' });
    expect((chunks[0] as { message: string }).message).toContain(
      'OLLAMA_REQUEST_TIMEOUT_MS',
    );
  });

  it('status de erro do Ollama vira chunk de erro, não exceção', async () => {
    const host = await subir((_req, res) => {
      res.writeHead(500);
      res.end('boom');
    });

    const chunks = await coletar(host);

    expect(chunks).toEqual([
      {
        type: 'error',
        code: 'upstream',
        message: 'Ollama respondeu com status 500',
      },
    ]);
  });

  it('conexão recusada vira chunk de erro', async () => {
    // Porta fechada: nada escutando.
    const chunks = await coletar('http://127.0.0.1:1');

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ type: 'error' });
    expect((chunks[0] as { message: string }).message).toContain(
      'Falha ao conectar no Ollama',
    );
  });
});
