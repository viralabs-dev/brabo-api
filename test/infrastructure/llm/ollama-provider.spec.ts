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
    delete process.env.OLLAMA_HOST;
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

  /**
   * A camada de MODELO da capability de embedding (ADR 0075), lida do
   * `/api/tags`. O Ollama é o único dos nove que publica isso por modelo — o
   * corpo abaixo é o do daemon 0.32.1, copiado da resposta real.
   */
  describe('catálogo: quem é modelo de embedding sai do próprio /api/tags', () => {
    function tags(modelos: unknown[]) {
      return subir((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: modelos }));
      });
    }

    it('declara supportsEmbeddings e a dimensão de quem é de embedding', async () => {
      process.env.OLLAMA_HOST = await tags([
        {
          name: 'nomic-embed-text:latest',
          capabilities: ['embedding'],
          details: { family: 'nomic-bert', embedding_length: 768 },
        },
        {
          name: 'llama3.2:1b',
          capabilities: ['completion', 'tools'],
          // Todo modelo de chat TAMBÉM tem `embedding_length` (é o vetor
          // interno dele) — copiá-lo faria um modelo de chat parecer
          // indexável, e é por isso que a dimensão só acompanha quem embeda.
          details: { family: 'llama', embedding_length: 2048 },
        },
      ]);

      const catalogo = await new OllamaProvider().listModels();

      expect(catalogo).toEqual([
        {
          name: 'nomic-embed-text:latest',
          supportsToolCalling: true,
          supportsEmbeddings: true,
          embeddingDimensions: 768,
        },
        {
          name: 'llama3.2:1b',
          supportsToolCalling: true,
          supportsEmbeddings: false,
        },
      ]);
    });

    it('daemon antigo, sem `capabilities`: não declara nada em vez de dizer false', async () => {
      // Ausência é "o provider não disse" (ADR 0041). Um `false` aqui seria
      // afirmação nossa sobre o que o daemon não respondeu.
      process.env.OLLAMA_HOST = await tags([
        { name: 'llama3.2:1b', details: { family: 'llama' } },
      ]);

      const catalogo = await new OllamaProvider().listModels();

      expect(catalogo).toEqual([
        { name: 'llama3.2:1b', supportsToolCalling: true },
      ]);
    });
  });

  describe('embed', () => {
    it('POST /api/embed: um vetor por entrada, com a contagem do daemon', async () => {
      const host = await subir((req, res) => {
        expect(req.url).toBe('/api/embed');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            model: 'nomic-embed-text',
            embeddings: [
              [0.1, 0.2],
              [0.3, 0.4],
            ],
            prompt_eval_count: 10,
          }),
        );
      });

      const resultado = await new OllamaProvider().embed(['um', 'dois'], {
        model: 'nomic-embed-text',
        host,
      });

      expect(resultado).toEqual({
        vectors: [
          [0.1, 0.2],
          [0.3, 0.4],
        ],
        dimensions: 2,
        model: 'nomic-embed-text',
        inputTokens: 10,
        estimated: false,
      });
    });

    it('modelo de chat: o 501 do daemon vira erro normalizado, não vetor vazio', async () => {
      // Resposta REAL do daemon 0.32.1 pedindo embedding de `llama3.2:1b`.
      const host = await subir((_req, res) => {
        res.writeHead(501, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error:
              'This server does not support embeddings. Start it with `--embeddings`',
          }),
        );
      });

      await expect(
        new OllamaProvider().embed(['um'], { model: 'llama3.2:1b', host }),
      ).rejects.toMatchObject({ code: 'upstream' });
    });
  });
});
