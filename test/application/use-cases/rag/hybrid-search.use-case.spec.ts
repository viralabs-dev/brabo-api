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
import { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import {
  RagTelemetryRepository,
  type NewRagFeedback,
  type NewRagSearch,
  type RagFeedbackRecord,
  type RagSearchRecord,
} from '../../../../src/application/ports/rag-telemetry-repository.port';

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
    embedQuery: async () => ({
      vector: vetor,
      available,
      reason: available ? undefined : 'indisponível',
    }),
    embedMany: async () => {
      throw new Error('não usado neste teste');
    },
  } as unknown as RagEmbeddingService;
}

/**
 * Telemetria de teste (RN-479): guarda o que foi gravado para as asserções, e
 * sabe FALHAR sob comando — é o caso que prova que o instrumento de medição
 * não derruba a busca.
 */
class FakeRagTelemetryRepository extends RagTelemetryRepository {
  gravadas: NewRagSearch[] = [];
  falharNoInsert = false;

  async recordSearch(input: NewRagSearch): Promise<RagSearchRecord> {
    if (this.falharNoInsert) throw new Error('rag_searches fora do ar');
    this.gravadas.push(input);
    return {
      ...input,
      id: `search-${this.gravadas.length}`,
      createdAt: new Date(),
    };
  }
  async findSearchById(): Promise<RagSearchRecord | null> {
    throw new Error('não usado neste teste');
  }
  async recordFeedback(_input: NewRagFeedback): Promise<RagFeedbackRecord> {
    throw new Error('não usado neste teste');
  }
}

/** `AppendSessionEventUseCase` de teste — só registra o que foi narrado. */
function fakeEventos() {
  const narrados: {
    projectId: string;
    sessionId: string;
    type: string;
    payload: Record<string, unknown>;
  }[] = [];
  const uc = {
    execute: async (
      projectId: string,
      sessionId: string,
      input: { type: string; payload: Record<string, unknown> },
    ) => {
      narrados.push({
        projectId,
        sessionId,
        type: input.type,
        payload: input.payload,
      });
      return undefined;
    },
  } as unknown as AppendSessionEventUseCase;
  return { uc, narrados };
}

function montar(
  repo: FakeChunkRepository,
  embeddings: RagEmbeddingService,
  telemetry = new FakeRagTelemetryRepository(),
  eventos = fakeEventos(),
) {
  return {
    useCase: new HybridSearchUseCase(repo, embeddings, telemetry, eventos.uc),
    telemetry,
    eventos,
  };
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

    const { useCase } = montar(repo, embeddingServiceComVetor([1, 2, 3]));
    const resultado = await useCase.execute({
      projectId: 'proj-1',
      query: 'pergunta real',
    });

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
    const { useCase } = montar(repo, embeddingServiceComVetor([1, 2, 3]));

    await expect(
      useCase.execute({ projectId: 'proj-1', query: 'a' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('quando o embedding está indisponível, degrada para busca só léxica e avisa', async () => {
    const repo = new FakeChunkRepository();
    const chunkLexico = mkChunk('lex', {});
    repo.lexicalResult = [{ chunk: chunkLexico, score: 0.5 }];

    const { useCase } = montar(repo, embeddingServiceComVetor(null, false));
    const resultado = await useCase.execute({
      projectId: 'proj-1',
      query: 'pergunta real',
    });

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

    const { useCase } = montar(repo, embeddingServiceComVetor([1, 2, 3]));
    const resultado = await useCase.execute({
      projectId: 'proj-1',
      query: 'pergunta real',
    });

    expect(resultado.hits[0].origin).toEqual({
      kind: 'session',
      sessionId: 'sessao-1',
      eventId: 'evt-1',
      title: 'user:abc',
    });
  });
  // ---------------------------------------------------------------- RN-479

  it('RN-479: grava a linha de telemetria com os pesos CONGELADOS e o rank de cada hit', async () => {
    const repo = new FakeChunkRepository();
    repo.vectorResult = [
      { chunk: mkChunk('a'), score: 0.9 },
      { chunk: mkChunk('b'), score: 0.5 },
    ];

    const { useCase, telemetry } = montar(
      repo,
      embeddingServiceComVetor([1, 2, 3]),
    );
    const resultado = await useCase.execute({
      projectId: 'proj-1',
      query: 'pergunta real',
      actor: { kind: 'user', id: 'u-1' },
    });

    expect(resultado.searchId).toBe('search-1');
    expect(telemetry.gravadas).toHaveLength(1);
    const linha = telemetry.gravadas[0];
    expect(linha.projectId).toBe('proj-1');
    // Veio da ABA: sem sessão. É o caso que impede a telemetria de ser só
    // evento (`session_events.session_id` é NOT NULL).
    expect(linha.sessionId).toBeNull();
    expect(linha.actorKind).toBe('user');
    expect(linha.actorId).toBe('u-1');
    expect(linha.degraded).toBe(false);
    expect(linha.vectorAvailable).toBe(true);
    expect(linha.latencyMs).toBeGreaterThanOrEqual(0);
    // Os pesos vão na linha, não são lidos de novo na hora de medir — é o que
    // faz a medição continuar significando o mesmo depois da calibração.
    expect(linha.pesos).toEqual({ vector: 0.6, lexical: 0.4, threshold: 0.2 });
    expect(linha.hits.map((h) => [h.chunkId, h.rank])).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
  });

  it('RN-479: os pesos da linha são uma CÓPIA — mexer nela não contamina a próxima busca', async () => {
    const repo = new FakeChunkRepository();
    repo.vectorResult = [{ chunk: mkChunk('a'), score: 0.9 }];

    const { useCase, telemetry } = montar(
      repo,
      embeddingServiceComVetor([1, 2, 3]),
    );
    await useCase.execute({ projectId: 'proj-1', query: 'pergunta real' });
    telemetry.gravadas[0].pesos.vector = 999;
    await useCase.execute({ projectId: 'proj-1', query: 'pergunta real' });

    expect(telemetry.gravadas[1].pesos.vector).toBe(0.6);
  });

  it('RN-481: narra `rag.search` na timeline QUANDO há sessão (caminho do agente)', async () => {
    const repo = new FakeChunkRepository();
    repo.vectorResult = [{ chunk: mkChunk('a'), score: 0.9 }];

    const { useCase, eventos, telemetry } = montar(
      repo,
      embeddingServiceComVetor([1, 2, 3]),
    );
    await useCase.execute({
      projectId: 'proj-1',
      query: 'pergunta real',
      sessionId: 'sess-1',
      actor: { kind: 'agent', id: 'qa' },
    });

    expect(telemetry.gravadas[0].sessionId).toBe('sess-1');
    expect(eventos.narrados).toHaveLength(1);
    expect(eventos.narrados[0]).toMatchObject({
      projectId: 'proj-1',
      sessionId: 'sess-1',
      type: 'rag.search',
    });
    expect(eventos.narrados[0].payload).toMatchObject({
      searchId: 'search-1',
      hits: 1,
      degraded: false,
    });
  });

  it('RN-481: a busca da ABA grava a tabela e NÃO narra evento nenhum', async () => {
    const repo = new FakeChunkRepository();
    repo.vectorResult = [{ chunk: mkChunk('a'), score: 0.9 }];

    const { useCase, eventos, telemetry } = montar(
      repo,
      embeddingServiceComVetor([1, 2, 3]),
    );
    await useCase.execute({ projectId: 'proj-1', query: 'pergunta real' });

    expect(telemetry.gravadas).toHaveLength(1);
    expect(eventos.narrados).toHaveLength(0);
  });

  it('CASO DE FALHA (RN-479): telemetria que não grava NÃO derruba a busca — `searchId` vira null', async () => {
    const repo = new FakeChunkRepository();
    repo.vectorResult = [{ chunk: mkChunk('a'), score: 0.9 }];
    const telemetry = new FakeRagTelemetryRepository();
    telemetry.falharNoInsert = true;

    const { useCase, eventos } = montar(
      repo,
      embeddingServiceComVetor([1, 2, 3]),
      telemetry,
    );
    const resultado = await useCase.execute({
      projectId: 'proj-1',
      query: 'pergunta real',
      sessionId: 'sess-1',
    });

    // A resposta é de quem perguntou, não do instrumento de medição.
    expect(resultado.hits.map((h) => h.chunkId)).toEqual(['a']);
    // Mas não passa por gravada: `null` diz à UI que não há a que anexar voto.
    expect(resultado.searchId).toBeNull();
    // E sem linha não há o que narrar — o evento carrega o `searchId`.
    expect(eventos.narrados).toHaveLength(0);
  });
});
