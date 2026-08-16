import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  ChunkRepository,
  type Chunk,
  type ChunkSearchCandidate,
  type ChunkSearchOptions,
} from '../../../../src/application/ports/chunk-repository.port';
import { RagEmbeddingService } from '../../../../src/application/use-cases/rag/rag-embedding.service';
import { HybridSearchUseCase } from '../../../../src/application/use-cases/rag/hybrid-search.use-case';

function mkChunk(id: string, overrides: Partial<Chunk> = {}): Chunk {
  return {
    id,
    projectId: 'proj-1',
    scope: 'docs',
    sessionId: null,
    sourcePath: 'docs/intro.md',
    content: `conteúdo do chunk ${id}`,
    embedding: null,
    metadata: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

class FakeChunkRepository extends ChunkRepository {
  vectorResult: ChunkSearchCandidate[] = [];
  lexicalResult: ChunkSearchCandidate[] = [];

  async create(): Promise<Chunk> {
    throw new Error('não usado neste teste');
  }
  async createMany(): Promise<Chunk[]> {
    throw new Error('não usado neste teste');
  }
  async findById(): Promise<Chunk | null> {
    throw new Error('não usado neste teste');
  }
  async listByProject(): Promise<Chunk[]> {
    throw new Error('não usado neste teste');
  }
  async deleteByScope(): Promise<number> {
    throw new Error('não usado neste teste');
  }
  async deleteBySession(): Promise<number> {
    throw new Error('não usado neste teste');
  }
  async searchByVector(
    _projectId: string,
    _queryVector: number[],
    _opts: ChunkSearchOptions,
  ): Promise<ChunkSearchCandidate[]> {
    return this.vectorResult;
  }
  async searchByLexicalQuery(
    _projectId: string,
    _query: string,
    _opts: ChunkSearchOptions,
  ): Promise<ChunkSearchCandidate[]> {
    return this.lexicalResult;
  }
}

/** Um `RagEmbeddingService` de teste, sem provider nenhum por trás. */
function embeddingServiceComVetor(vetor: number[] | null, available = true) {
  return {
    embedQuery: async () => ({ vector: vetor, available, reason: available ? undefined : 'indisponível' }),
    embedMany: async () => {
      throw new Error('não usado neste teste');
    },
  } as unknown as RagEmbeddingService;
}

describe('HybridSearchUseCase', () => {
  it('funde vetor e léxico por soma ponderada, ordena e corta pelo limiar', async () => {
    const repo = new FakeChunkRepository();
    const chunkForte = mkChunk('forte', {});
    const chunkSoLexico = mkChunk('so-lexico', {});
    const chunkFraco = mkChunk('fraco', {});

    repo.vectorResult = [
      { chunk: chunkForte, score: 0.9 },
      { chunk: chunkFraco, score: 0.1 },
    ];
    repo.lexicalResult = [
      { chunk: chunkForte, score: 0.3 },
      { chunk: chunkSoLexico, score: 0.25 },
    ];

    const useCase = new HybridSearchUseCase(repo, embeddingServiceComVetor([1, 2, 3]));
    const resultado = await useCase.execute({ projectId: 'proj-1', query: 'pergunta real' });

    expect(resultado.vectorAvailable).toBe(true);
    // forte: 0.6*0.9 + 0.4*0.3 = 0.66
    // fraco: 0.6*0.1 + 0.4*0 = 0.06 → abaixo do limiar (0.2), fora
    // so-lexico: 0.6*0 + 0.4*0.25 = 0.10 → abaixo do limiar, fora
    expect(resultado.hits.map((h) => h.chunkId)).toEqual(['forte']);
    expect(resultado.hits[0].score).toBeCloseTo(0.66, 5);
    expect(resultado.hits[0].vectorScore).toBe(0.9);
    expect(resultado.hits[0].lexicalScore).toBe(0.3);
    expect(resultado.hits[0].origin).toEqual({
      kind: 'file',
      sourcePath: 'docs/intro.md',
      headingPath: undefined,
      title: undefined,
    });
  });

  it('CASO DE FALHA: query fora da faixa de tamanho é recusada com BadRequestException', async () => {
    const repo = new FakeChunkRepository();
    const useCase = new HybridSearchUseCase(repo, embeddingServiceComVetor([1, 2, 3]));

    await expect(
      useCase.execute({ projectId: 'proj-1', query: 'a' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('quando o embedding está indisponível, degrada para busca só léxica e avisa', async () => {
    const repo = new FakeChunkRepository();
    const chunkLexico = mkChunk('lex', {});
    repo.lexicalResult = [{ chunk: chunkLexico, score: 0.5 }];

    const useCase = new HybridSearchUseCase(
      repo,
      embeddingServiceComVetor(null, false),
    );
    const resultado = await useCase.execute({ projectId: 'proj-1', query: 'pergunta real' });

    expect(resultado.vectorAvailable).toBe(false);
    expect(resultado.vectorUnavailableReason).toBe('indisponível');
    // 0.6*0 + 0.4*0.5 = 0.20 — exatamente no limiar, passa.
    expect(resultado.hits.map((h) => h.chunkId)).toEqual(['lex']);
    expect(resultado.hits[0].vectorScore).toBeNull();
  });

  it('citação de chunk de sessão usa origin { kind: "session" }', async () => {
    const repo = new FakeChunkRepository();
    const chunkSessao = mkChunk('sess', {
      scope: 'session',
      sessionId: 'sessao-1',
      sourcePath: null,
      metadata: { sourceRef: 'evt-1', title: 'user:abc' },
    });
    repo.vectorResult = [{ chunk: chunkSessao, score: 0.8 }];

    const useCase = new HybridSearchUseCase(repo, embeddingServiceComVetor([1, 2, 3]));
    const resultado = await useCase.execute({ projectId: 'proj-1', query: 'pergunta real' });

    expect(resultado.hits[0].origin).toEqual({
      kind: 'session',
      sessionId: 'sessao-1',
      eventId: 'evt-1',
      title: 'user:abc',
    });
  });
});
