import { describe, expect, it, vi } from 'vitest';
import { Logger, NotFoundException } from '@nestjs/common';
import type { GitTree } from '@brabo/shared';
import type { ReadProjectCodeUseCase } from '../../../../src/application/use-cases/git/read-project-code.use-case';
import {
  ChunkRepository,
  type Chunk,
  type NewChunk,
} from '../../../../src/application/ports/chunk-repository.port';
import { RagEmbeddingService } from '../../../../src/application/use-cases/rag/rag-embedding.service';
import { GIT_BLOB_MAX_BYTES } from '../../../../src/domain/git/git-read-limits';
import { RAG_INDEX_FILE_MAX_BYTES } from '../../../../src/domain/rag/rag-search-limits';
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
    // Igual ao `file` de verdade: sem `maxBytes` o teto é o da aba Code.
    file: (
      _projectId: string,
      path: string,
      _ref?: string,
      maxBytes: number = GIT_BLOB_MAX_BYTES,
    ) => {
      const conteudo = opts.files[path];
      if (conteudo === undefined)
        return Promise.reject(new NotFoundException(`sem arquivo "${path}"`));
      const bruto = Buffer.from(conteudo, 'utf8');
      const truncated = bruto.byteLength > maxBytes;
      const devolvido = truncated
        ? bruto.subarray(0, maxBytes).toString('utf8')
        : conteudo;
      return Promise.resolve({
        ref: 'dev',
        path,
        content: devolvido,
        truncated,
        bytes: Buffer.byteLength(devolvido, 'utf8'),
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
    expect(relatorio.cutFiles).toEqual([]);
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
  describe('teto próprio de indexação (RN-1036)', () => {
    const ARVORE_UM = (nome: string, size: number): GitTree => ({
      ref: 'dev',
      path: 'docs',
      truncated: false,
      entries: [{ path: `docs/${nome}`, name: nome, type: 'file', size }],
    });
    const usar = (nome: string, conteudo: string) => {
      const repo = new FakeChunkRepository();
      const useCase = new IndexProjectDocsUseCase(
        fakeReadCode({
          trees: { docs: ARVORE_UM(nome, Buffer.byteLength(conteudo)) },
          files: { [`docs/${nome}`]: conteudo },
        }),
        repo,
        embeddingServiceQueVetoriza(true),
      );
      return { repo, useCase };
    };
    /** Seções de ~1 KiB cada, com um marcador único no fim. */
    const documento = (bytes: number) => {
      const secao = (i: number) => `## Seção ${i}\n${'x'.repeat(1000)}\n`;
      let texto = '# Doc\n';
      for (let i = 0; texto.length < bytes; i++) texto += secao(i);
      return `${texto}## FIM\nMARCADOR-FINAL\n`;
    };

    it('arquivo de 600 KiB (acima da aba Code, abaixo do teto) é indexado até o fim', async () => {
      const { repo, useCase } = usar('grande.md', documento(600 * 1024));

      const relatorio = await useCase.execute('proj-1');

      expect(
        repo.created.some((c) => c.content.includes('MARCADOR-FINAL')),
      ).toBe(true);
      expect(relatorio.cutFiles).toEqual([]);
      expect(repo.created.every((c) => !c.metadata?.sourceCut)).toBe(true);
    });

    it('arquivo acima do teto é cortado e DECLARADO: cutFiles com os bytes originais, sourceCut nos chunks, aviso no log', async () => {
      const conteudo = documento(RAG_INDEX_FILE_MAX_BYTES + 10 * 1024);
      const { repo, useCase } = usar('enorme.md', conteudo);
      const aviso = vi.spyOn(Logger.prototype, 'warn').mockImplementation();

      const relatorio = await useCase.execute('proj-1');

      expect(relatorio.cutFiles).toEqual([
        {
          path: 'docs/enorme.md',
          bytes: Buffer.byteLength(conteudo),
          reason: 'too_large',
        },
      ]);
      expect(repo.created.length).toBeGreaterThan(0);
      expect(repo.created.every((c) => c.metadata?.sourceCut === true)).toBe(
        true,
      );
      expect(
        repo.created.some((c) => c.content.includes('MARCADOR-FINAL')),
      ).toBe(false);
      expect(aviso).toHaveBeenCalledWith(
        expect.stringContaining('docs/enorme.md'),
      );
      aviso.mockRestore();
    });

    it('.md com byte nulo é pulado e declarado, sem chunk', async () => {
      const { repo, useCase } = usar('bin.md', '# Bin\nabc\0def');
      const aviso = vi.spyOn(Logger.prototype, 'warn').mockImplementation();

      const relatorio = await useCase.execute('proj-1');

      expect(repo.created).toEqual([]);
      expect(relatorio.cutFiles).toEqual([
        { path: 'docs/bin.md', bytes: 13, reason: 'binary' },
      ]);
      expect(relatorio.docsChunks).toBe(0);
      aviso.mockRestore();
    });
  });
});
