import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  ChunkRepository,
  type Chunk,
  type ChunkScope,
  type NewChunk,
} from '../../../../src/application/ports/chunk-repository.port';
import { RagEmbeddingService } from '../../../../src/application/use-cases/rag/rag-embedding.service';
import {
  IndexLocalFolderUseCase,
  type LocalFolderFile,
} from '../../../../src/application/use-cases/rag/index-local-folder.use-case';
import {
  RAG_LOCAL_FILE_BYTES_LIMIT,
  RAG_LOCAL_FILE_COUNT_LIMIT,
  RAG_LOCAL_TOTAL_BYTES_LIMIT,
} from '../../../../src/domain/rag/rag-search-limits';

class FakeChunkRepository extends ChunkRepository {
  created: NewChunk[] = [];
  deletedScopes: string[] = [];

  async create(input: NewChunk): Promise<Chunk> {
    return (await this.createMany([input]))[0];
  }
  async createMany(inputs: NewChunk[]): Promise<Chunk[]> {
    this.created.push(...inputs);
    return inputs.map((input, i) => ({
      id: `chunk-${this.created.length}-${i}`,
      projectId: input.projectId,
      scope: input.scope,
      sessionId: input.sessionId ?? null,
      sourcePath: input.sourcePath ?? null,
      content: input.content,
      embedding: input.embedding ?? null,
      metadata: input.metadata ?? {},
      createdAt: new Date(),
    }));
  }
  async findById(): Promise<Chunk | null> {
    throw new Error('não usado neste teste');
  }
  async listByProject(): Promise<Chunk[]> {
    throw new Error('não usado neste teste');
  }
  async deleteByScope(_projectId: string, scope: ChunkScope): Promise<number> {
    this.deletedScopes.push(scope);
    return 0;
  }
  async deleteBySession(): Promise<number> {
    throw new Error('não usado neste teste');
  }
  async searchByVector(): Promise<never[]> {
    throw new Error('não usado neste teste');
  }
  async searchByLexicalQuery(): Promise<never[]> {
    throw new Error('não usado neste teste');
  }
}

function embeddingServiceQueVetoriza(available: boolean) {
  return {
    embedMany: async (texts: readonly string[]) => ({
      vectors: available
        ? texts.map((_, i) => [i, i + 1])
        : texts.map(() => null),
      available,
      reason: available ? undefined : 'provider indisponível',
    }),
    embedQuery: async () => {
      throw new Error('não usado neste teste');
    },
  } as unknown as RagEmbeddingService;
}

describe('IndexLocalFolderUseCase', () => {
  it('caminho feliz: chunka markdown por heading e o resto por tamanho, com vetor', async () => {
    const repo = new FakeChunkRepository();
    const useCase = new IndexLocalFolderUseCase(
      repo,
      embeddingServiceQueVetoriza(true),
    );
    const files: LocalFolderFile[] = [
      { path: 'README.md', content: '# Título\numa introdução curta.' },
      { path: 'src/index.ts', content: 'export const x = 1;' },
    ];

    const relatorio = await useCase.execute(
      'proj-1',
      'user-1',
      'meu-projeto',
      files,
    );

    expect(relatorio.folderName).toBe('meu-projeto');
    expect(relatorio.filesIndexed).toBe(2);
    expect(relatorio.filesSkipped).toBe(0);
    expect(relatorio.chunksCreated).toBe(2);
    expect(relatorio.embedding).toEqual({
      available: true,
      embedded: 2,
      skipped: 0,
    });
    expect(repo.deletedScopes).toEqual(['local']);

    const readme = repo.created.find((c) => c.sourcePath === 'README.md')!;
    expect(readme.scope).toBe('local');
    expect(readme.metadata?.folderName).toBe('meu-projeto');
    expect(readme.metadata?.uploadedBy).toBe('user-1');
    expect(readme.embedding).not.toBeNull();
  });

  it('reindexa por FULL REBUILD: apaga o escopo `local` antes de escrever os novos', async () => {
    const repo = new FakeChunkRepository();
    const useCase = new IndexLocalFolderUseCase(
      repo,
      embeddingServiceQueVetoriza(true),
    );

    await useCase.execute('proj-1', 'user-1', 'pasta-1', [
      { path: 'a.txt', content: 'a' },
    ]);
    await useCase.execute('proj-1', 'user-1', 'pasta-2', [
      { path: 'b.txt', content: 'b' },
    ]);

    expect(repo.deletedScopes).toEqual(['local', 'local']);
  });

  it('arquivo grande demais ou de extensão não reconhecida é PULADO, sem derrubar o lote', async () => {
    const repo = new FakeChunkRepository();
    const useCase = new IndexLocalFolderUseCase(
      repo,
      embeddingServiceQueVetoriza(true),
    );
    const files: LocalFolderFile[] = [
      { path: 'ok.md', content: '# ok\nconteúdo válido.' },
      { path: 'binario.png', content: 'não é texto de verdade' },
      {
        path: 'gigante.txt',
        content: 'x'.repeat(RAG_LOCAL_FILE_BYTES_LIMIT + 1),
      },
    ];

    const relatorio = await useCase.execute('proj-1', 'user-1', 'pasta', files);

    expect(relatorio.filesIndexed).toBe(1);
    expect(relatorio.filesSkipped).toBe(2);
    expect(repo.created.every((c) => c.sourcePath === 'ok.md')).toBe(true);
  });

  it('CASO DE FALHA: provider de embedding indisponível grava os chunks SEM vetor e declara a lacuna', async () => {
    const repo = new FakeChunkRepository();
    const useCase = new IndexLocalFolderUseCase(
      repo,
      embeddingServiceQueVetoriza(false),
    );

    const relatorio = await useCase.execute('proj-1', 'user-1', 'pasta', [
      { path: 'a.txt', content: 'conteúdo' },
    ]);

    expect(relatorio.embedding).toEqual({
      available: false,
      embedded: 0,
      skipped: 1,
      reason: 'provider indisponível',
    });
    expect(repo.created.every((c) => c.embedding === null)).toBe(true);
  });

  it('CASO DE FALHA: mais arquivos que o teto REJEITA (400), nunca trunca em silêncio', async () => {
    const repo = new FakeChunkRepository();
    const useCase = new IndexLocalFolderUseCase(
      repo,
      embeddingServiceQueVetoriza(true),
    );
    const files: LocalFolderFile[] = Array.from(
      { length: RAG_LOCAL_FILE_COUNT_LIMIT + 1 },
      (_, i) => ({ path: `arquivo-${i}.txt`, content: 'x' }),
    );

    await expect(
      useCase.execute('proj-1', 'user-1', 'pasta', files),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.created).toEqual([]);
    expect(repo.deletedScopes).toEqual([]);
  });

  it('CASO DE FALHA: bytes somados acima do teto REJEITA (400)', async () => {
    const repo = new FakeChunkRepository();
    const useCase = new IndexLocalFolderUseCase(
      repo,
      embeddingServiceQueVetoriza(true),
    );
    const conteudoGrande = 'x'.repeat(RAG_LOCAL_FILE_BYTES_LIMIT);
    // Bytes somados > RAG_LOCAL_TOTAL_BYTES_LIMIT, cada arquivo individualmente dentro do teto por arquivo.
    const quantidade =
      Math.ceil(RAG_LOCAL_TOTAL_BYTES_LIMIT / RAG_LOCAL_FILE_BYTES_LIMIT) + 1;
    const files: LocalFolderFile[] = Array.from(
      { length: quantidade },
      (_, i) => ({
        path: `arquivo-${i}.txt`,
        content: conteudoGrande,
      }),
    );

    await expect(
      useCase.execute('proj-1', 'user-1', 'pasta', files),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('CASO DE FALHA: caminho com ".." ou barra inicial é REJEITADO (400), nunca aceito', async () => {
    const repo = new FakeChunkRepository();
    const useCase = new IndexLocalFolderUseCase(
      repo,
      embeddingServiceQueVetoriza(true),
    );

    await expect(
      useCase.execute('proj-1', 'user-1', 'pasta', [
        { path: '../fora-da-pasta.txt', content: 'x' },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      useCase.execute('proj-1', 'user-1', 'pasta', [
        { path: '/etc/passwd', content: 'x' },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
