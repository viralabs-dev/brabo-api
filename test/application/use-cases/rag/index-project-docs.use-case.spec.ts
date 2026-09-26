import { describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { GitTree } from '@brabo/shared';
import type { ReadProjectCodeUseCase } from '../../../../src/application/use-cases/git/read-project-code.use-case';
import {
  ChunkRepository,
  type Chunk,
  type NewChunk,
} from '../../../../src/application/ports/chunk-repository.port';
import { RagEmbeddingService } from '../../../../src/application/use-cases/rag/rag-embedding.service';
import { IndexProjectDocsUseCase } from '../../../../src/application/use-cases/rag/index-project-docs.use-case';

class FakeChunkRepository extends ChunkRepository {
  created: NewChunk[] = [];
  deletedScopes: string[] = [];

  async create(input: NewChunk): Promise<Chunk> {
    return (await this.createMany([input]))[0];
  }
  createMany(inputs: NewChunk[]): Promise<Chunk[]> {
    this.created.push(...inputs);
    return Promise.resolve(
      inputs.map((input, i) => ({
        id: `chunk-${this.created.length}-${i}`,
        projectId: input.projectId,
        scope: input.scope,
        sessionId: input.sessionId ?? null,
        sourcePath: input.sourcePath ?? null,
        content: input.content,
        embedding: input.embedding ?? null,
        metadata: input.metadata ?? {},
        createdAt: new Date(),
      })),
    );
  }
  findById(): Promise<Chunk | null> {
    return Promise.reject(new Error('não usado neste teste'));
  }
  listByProject(): Promise<Chunk[]> {
    return Promise.reject(new Error('não usado neste teste'));
  }
  deleteByScope(_projectId: string, scope: 'docs' | 'adr'): Promise<number> {
    this.deletedScopes.push(scope);
    return Promise.resolve(0);
  }
  deleteBySession(): Promise<number> {
    return Promise.reject(new Error('não usado neste teste'));
  }
  searchByVector(): Promise<never[]> {
    return Promise.reject(new Error('não usado neste teste'));
  }
  searchByLexicalQuery(): Promise<never[]> {
    return Promise.reject(new Error('não usado neste teste'));
  }
}

function fakeReadCode(opts: {
  trees: Record<string, GitTree>;
  files: Record<string, string>;
}): ReadProjectCodeUseCase {
  return {
    tree: (_projectId: string, _ref: string | undefined, path?: string) => {
      const chave = path ?? '';
      const arvore = opts.trees[chave];
      if (!arvore)
        return Promise.reject(
          new NotFoundException(`sem árvore em "${chave}"`),
        );
      return Promise.resolve(arvore);
    },
    file: (_projectId: string, path: string) => {
      const conteudo = opts.files[path];
      if (conteudo === undefined)
        return Promise.reject(new NotFoundException(`sem arquivo "${path}"`));
      return Promise.resolve({
        ref: 'dev',
        path,
        content: conteudo,
        truncated: false,
        bytes: conteudo.length,
      });
    },
  } as unknown as ReadProjectCodeUseCase;
}

function embeddingServiceQueVetoriza(available: boolean) {
  return {
    embedMany: (texts: readonly string[]) =>
      Promise.resolve({
        vectors: available
          ? texts.map((_, i) => [i, i + 1])
          : texts.map(() => null),
        available,
        reason: available ? undefined : 'provider indisponível',
      }),
    embedQuery: () => {
      return Promise.reject(new Error('não usado neste teste'));
    },
  } as unknown as RagEmbeddingService;
}

const ARVORE_DOCS: GitTree = {
  ref: 'dev',
  path: 'docs',
  truncated: false,
  entries: [
    { path: 'docs/adr', name: 'adr', type: 'dir', size: null },
    { path: 'docs/intro.md', name: 'intro.md', type: 'file', size: 30 },
    { path: 'docs/imagem.png', name: 'imagem.png', type: 'file', size: 999 },
  ],
};

const ARVORE_ADR: GitTree = {
  ref: 'dev',
  path: 'docs/adr',
  truncated: false,
  entries: [
    {
      path: 'docs/adr/0001-primeiro.md',
      name: '0001-primeiro.md',
      type: 'file',
      size: 20,
    },
  ],
};

describe('IndexProjectDocsUseCase', () => {
  it('indexa docs e adr por prefixo de caminho, com vetor quando o provider está disponível', async () => {
    const repo = new FakeChunkRepository();
    const readCode = fakeReadCode({
      trees: { docs: ARVORE_DOCS, 'docs/adr': ARVORE_ADR },
      files: {
        'docs/intro.md': '# Intro\numa introdução curta.',
        'docs/adr/0001-primeiro.md': '# ADR 0001\ndecisão registrada.',
      },
    });
    const useCase = new IndexProjectDocsUseCase(
      readCode,
      repo,
      embeddingServiceQueVetoriza(true),
    );

    const relatorio = await useCase.execute('proj-1');

    expect(relatorio.filesScanned).toBe(2); // .png ignorado
    expect(relatorio.docsChunks).toBe(1);
    expect(relatorio.adrChunks).toBe(1);
    expect(relatorio.truncated).toBe(false);
    expect(relatorio.embedding).toEqual({
      available: true,
      embedded: 2,
      skipped: 0,
    });
    expect(repo.deletedScopes.sort()).toEqual(['adr', 'docs']);

    const docChunk = repo.created.find((c) => c.scope === 'docs')!;
    expect(docChunk.sourcePath).toBe('docs/intro.md');
    expect(docChunk.embedding).not.toBeNull();

    const adrChunk = repo.created.find((c) => c.scope === 'adr')!;
    expect(adrChunk.sourcePath).toBe('docs/adr/0001-primeiro.md');
  });

  it('CASO DE FALHA: provider de embedding indisponível grava os chunks SEM vetor e declara a lacuna', async () => {
    const repo = new FakeChunkRepository();
    const readCode = fakeReadCode({
      trees: { docs: ARVORE_DOCS, 'docs/adr': ARVORE_ADR },
      files: {
        'docs/intro.md': '# Intro\numa introdução curta.',
        'docs/adr/0001-primeiro.md': '# ADR 0001\ndecisão registrada.',
      },
    });
    const useCase = new IndexProjectDocsUseCase(
      readCode,
      repo,
      embeddingServiceQueVetoriza(false),
    );

    const relatorio = await useCase.execute('proj-1');

    expect(relatorio.docsChunks + relatorio.adrChunks).toBe(2);
    expect(relatorio.embedding).toEqual({
      available: false,
      embedded: 0,
      skipped: 2,
      reason: 'provider indisponível',
    });
    expect(repo.created.every((c) => c.embedding === null)).toBe(true);
  });

  it('projeto sem pasta docs/ indexa zero arquivos, sem lançar', async () => {
    const repo = new FakeChunkRepository();
    const readCode = fakeReadCode({ trees: {}, files: {} });
    const useCase = new IndexProjectDocsUseCase(
      readCode,
      repo,
      embeddingServiceQueVetoriza(true),
    );

    const relatorio = await useCase.execute('proj-1');

    expect(relatorio.filesScanned).toBe(0);
    expect(relatorio.docsChunks).toBe(0);
    expect(relatorio.adrChunks).toBe(0);
  });
});
