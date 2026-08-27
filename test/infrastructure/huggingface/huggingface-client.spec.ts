import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { searchHuggingFaceModels } from '../../../src/infrastructure/huggingface/huggingface-client';
import {
  HuggingFaceConnectionError,
  HuggingFaceUpstreamError,
} from '../../../src/domain/huggingface/huggingface-errors';

/**
 * Servidor HTTP fake em porta efêmera, mesmo molde de
 * `test/support/llm/fake-llm-server.ts`: o que está sob teste é o
 * comportamento de socket/status HTTP de verdade, não um mock de `fetch`.
 */
type Cenario = 'busca_ok' | 'erro_500' | 'nao_e_array' | 'nao_e_json';

let server: Server;
let baseUrl: string;
let cenario: Cenario = 'busca_ok';
let ultimoHeaderAuth: string | undefined;

const RESULTADO_HUB = [
  {
    id: 'meta-llama/Llama-3.1-8B-Instruct-GGUF',
    downloads: 182034,
    likes: 210,
  },
  {
    id: 'bartowski/Llama-3.1-8B-Instruct-GGUF',
    downloads: 50000,
    likes: 30,
  },
  // Sem `downloads`/`likes` — a doc do Hub não garante os dois sempre
  // presentes; o cliente tem que cair para 0, não quebrar.
  { id: 'Qwen/Qwen2.5-Coder-7B-Instruct-GGUF' },
];

beforeAll(async () => {
  server = createServer((req, res) => {
    ultimoHeaderAuth = req.headers.authorization;

    if (cenario === 'erro_500') {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('internal error');
      return;
    }
    if (cenario === 'nao_e_array') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ nao: 'e um array' }));
      return;
    }
    if (cenario === 'nao_e_json') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('isto não é JSON');
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(RESULTADO_HUB));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  cenario = 'busca_ok';
  ultimoHeaderAuth = undefined;
  process.env.HUGGINGFACE_HUB_URL = baseUrl;
  delete process.env.HUGGINGFACE_API_TOKEN;
});

afterEach(() => {
  delete process.env.HUGGINGFACE_HUB_URL;
  delete process.env.HUGGINGFACE_API_TOKEN;
});

describe('searchHuggingFaceModels', () => {
  it('caminho feliz: normaliza a resposta e marca official pelo allowlist', async () => {
    const resultados = await searchHuggingFaceModels({ query: 'llama' });

    expect(resultados).toEqual([
      {
        repoId: 'meta-llama/Llama-3.1-8B-Instruct-GGUF',
        publisher: 'meta-llama',
        downloads: 182034,
        likes: 210,
        official: true,
      },
      {
        repoId: 'bartowski/Llama-3.1-8B-Instruct-GGUF',
        publisher: 'bartowski',
        downloads: 50000,
        likes: 30,
        official: false,
      },
      {
        repoId: 'Qwen/Qwen2.5-Coder-7B-Instruct-GGUF',
        publisher: 'Qwen',
        downloads: 0,
        likes: 0,
        official: true,
      },
    ]);
  });

  it('sem HUGGINGFACE_API_TOKEN, não manda header Authorization', async () => {
    await searchHuggingFaceModels({ query: 'llama' });
    expect(ultimoHeaderAuth).toBeUndefined();
  });

  it('com HUGGINGFACE_API_TOKEN definido, manda Bearer', async () => {
    process.env.HUGGINGFACE_API_TOKEN = 'hf-chave-de-teste';
    await searchHuggingFaceModels({ query: 'llama' });
    expect(ultimoHeaderAuth).toBe('Bearer hf-chave-de-teste');
  });

  it('falha: status de erro do Hub vira HuggingFaceUpstreamError com o status', async () => {
    cenario = 'erro_500';
    const erro = await searchHuggingFaceModels({ query: 'llama' }).catch(
      (e: unknown) => e,
    );
    expect(erro).toBeInstanceOf(HuggingFaceUpstreamError);
    expect((erro as HuggingFaceUpstreamError).status).toBe(500);
  });

  it('falha: corpo que não é array lança HuggingFaceUpstreamError', async () => {
    cenario = 'nao_e_array';
    await expect(searchHuggingFaceModels({ query: 'llama' })).rejects.toThrow(
      HuggingFaceUpstreamError,
    );
  });

  it('falha: corpo que não é JSON válido lança HuggingFaceUpstreamError', async () => {
    cenario = 'nao_e_json';
    await expect(searchHuggingFaceModels({ query: 'llama' })).rejects.toThrow(
      HuggingFaceUpstreamError,
    );
  });

  it('falha: sem servidor nenhum no ar, lança HuggingFaceConnectionError', async () => {
    process.env.HUGGINGFACE_HUB_URL = 'http://127.0.0.1:1'; // porta reservada, sempre recusa
    await expect(searchHuggingFaceModels({ query: 'llama' })).rejects.toThrow(
      HuggingFaceConnectionError,
    );
  });
});
