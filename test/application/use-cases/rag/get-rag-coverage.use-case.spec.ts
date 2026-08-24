import { describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { ProjectRepository } from '../../../../src/application/ports/project-repository.port';
import type { SessionRepository } from '../../../../src/application/ports/session-repository.port';
import type { Project } from '../../../../src/domain/iam/project.entity';
import type { Session } from '../../../../src/domain/sessions/session.entity';
import {
  ChunkRepository,
  type Chunk,
} from '../../../../src/application/ports/chunk-repository.port';
import type { IndexProjectDocsUseCase } from '../../../../src/application/use-cases/rag/index-project-docs.use-case';
import { GetRagCoverageUseCase } from '../../../../src/application/use-cases/rag/get-rag-coverage.use-case';

function fakeProjects(project: Project | null): ProjectRepository {
  return { findById: async () => project } as unknown as ProjectRepository;
}

function fakeSessions(sessions: Session[]): SessionRepository {
  return {
    listForProject: async () => sessions,
  } as unknown as SessionRepository;
}

function mkChunk(overrides: Partial<Chunk>): Chunk {
  return {
    id: 'c',
    projectId: 'proj-1',
    scope: 'docs',
    sessionId: null,
    sourcePath: null,
    content: 'x',
    embedding: null,
    metadata: {},
    createdAt: new Date(),
    ...overrides,
  };
}

class FakeChunkRepository extends ChunkRepository {
  constructor(private readonly chunks: Chunk[]) {
    super();
  }
  async create(): Promise<Chunk> {
    throw new Error('não usado');
  }
  async createMany(): Promise<Chunk[]> {
    throw new Error('não usado');
  }
  async findById(): Promise<Chunk | null> {
    throw new Error('não usado');
  }
  async listByProject(): Promise<Chunk[]> {
    return this.chunks;
  }
  async deleteByScope(): Promise<number> {
    throw new Error('não usado');
  }
  async deleteBySession(): Promise<number> {
    throw new Error('não usado');
  }
  async searchByVector(): Promise<never[]> {
    throw new Error('não usado');
  }
  async searchByLexicalQuery(): Promise<never[]> {
    throw new Error('não usado');
  }
}

const PROJETO = { id: 'proj-1' } as Project;

describe('GetRagCoverageUseCase', () => {
  it('conta arquivos reais no repositório contra os que têm chunk, e sessões contra as indexadas', async () => {
    const dataDoUpload = new Date('2026-08-23T10:00:00Z');
    const chunks = new FakeChunkRepository([
      mkChunk({ scope: 'docs', sourcePath: 'docs/intro.md' }),
      mkChunk({ scope: 'adr', sourcePath: 'docs/adr/0001-a.md' }),
      mkChunk({ scope: 'session', sessionId: 'sess-1', sourcePath: null }),
      mkChunk({ scope: 'docs', sourcePath: 'docs/intro.md', embedding: null }),
      mkChunk({
        scope: 'local',
        sourcePath: 'README.md',
        metadata: { folderName: 'meu-projeto' },
        createdAt: dataDoUpload,
      }),
    ]);
    const indexDocs = {
      listarArquivosMarkdown: async () => ({
        paths: ['docs/intro.md', 'docs/sem-chunk.md', 'docs/adr/0001-a.md'],
        truncated: false,
      }),
    } as unknown as IndexProjectDocsUseCase;

    const useCase = new GetRagCoverageUseCase(
      fakeProjects(PROJETO),
      fakeSessions([{ id: 'sess-1' } as Session, { id: 'sess-2' } as Session]),
      chunks,
      indexDocs,
    );

    const cobertura = await useCase.execute('proj-1');

    expect(cobertura.docs).toEqual({
      filesInRepo: 2,
      filesIndexed: 1,
      truncated: false,
    });
    expect(cobertura.adr).toEqual({
      filesInRepo: 1,
      filesIndexed: 1,
      truncated: false,
    });
    expect(cobertura.session).toEqual({
      sessionsInProject: 2,
      sessionsIndexed: 1,
    });
    expect(cobertura.local).toEqual({
      filesIndexed: 1,
      folderName: 'meu-projeto',
      lastAttachedAt: dataDoUpload.toISOString(),
    });
    expect(cobertura.chunksTotal).toBe(5);
    expect(cobertura.chunksWithoutVector).toBe(5);
  });

  it('CASO DE FALHA (degradação honesta): sem chunk `local` nenhum, nunca inventa nome de pasta ou timestamp', async () => {
    const chunks = new FakeChunkRepository([
      mkChunk({ scope: 'docs', sourcePath: 'docs/intro.md' }),
    ]);
    const useCase = new GetRagCoverageUseCase(
      fakeProjects(PROJETO),
      fakeSessions([]),
      chunks,
      {
        listarArquivosMarkdown: async () => ({ paths: [], truncated: false }),
      } as unknown as IndexProjectDocsUseCase,
    );

    const cobertura = await useCase.execute('proj-1');

    expect(cobertura.local).toEqual({
      filesIndexed: 0,
      folderName: null,
      lastAttachedAt: null,
    });
  });

  it('CASO DE FALHA: projeto inexistente lança NotFoundException', async () => {
    const useCase = new GetRagCoverageUseCase(
      fakeProjects(null),
      fakeSessions([]),
      new FakeChunkRepository([]),
      {} as IndexProjectDocsUseCase,
    );

    await expect(useCase.execute('proj-inexistente')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
