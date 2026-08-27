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
import { SearchHuggingFaceModelsUseCase } from '../../../../../src/application/use-cases/llm/huggingface/search-huggingface-models.use-case';
import { HuggingFaceUpstreamError } from '../../../../../src/domain/huggingface/huggingface-errors';

type Cenario = 'busca_ok' | 'erro_503';
let cenario: Cenario = 'busca_ok';
let server: Server;
let baseUrl: string;

const RESULTADO_HUB = [
  { id: 'meta-llama/Llama-3.1-8B-Instruct-GGUF', downloads: 100, likes: 10 },
  { id: 'bartowski/Llama-3.1-8B-Instruct-GGUF', downloads: 50, likes: 5 },
  { id: 'random-user/Llama-3.1-8B-Instruct-GGUF', downloads: 5, likes: 1 },
];

beforeAll(async () => {
  server = createServer((_req, res) => {
    if (cenario === 'erro_503') {
      res.writeHead(503);
      res.end('unavailable');
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
  process.env.HUGGINGFACE_HUB_URL = baseUrl;
});

afterEach(() => {
  delete process.env.HUGGINGFACE_HUB_URL;
});

const useCase = new SearchHuggingFaceModelsUseCase();

describe('SearchHuggingFaceModelsUseCase', () => {
  it('caminho feliz: por padrão só devolve publishers OFICIAIS (ADR 0042 aplicado ao selo)', async () => {
    const resultados = await useCase.execute({ query: 'llama' });

    expect(resultados).toHaveLength(1);
    expect(resultados[0].repoId).toBe('meta-llama/Llama-3.1-8B-Instruct-GGUF');
    expect(resultados[0].official).toBe(true);
  });

  it('includeCommunity:true traz todos, cada um marcado official/community', async () => {
    const resultados = await useCase.execute({
      query: 'llama',
      includeCommunity: true,
    });

    expect(resultados).toHaveLength(3);
    expect(resultados.map((m) => m.official)).toEqual([true, false, false]);
  });

  it('falha: o Hub fora do ar propaga o erro normalizado', async () => {
    cenario = 'erro_503';
    await expect(useCase.execute({ query: 'llama' })).rejects.toThrow(
      HuggingFaceUpstreamError,
    );
  });
});
