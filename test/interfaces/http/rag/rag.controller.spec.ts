import { describe, expect, it, vi } from 'vitest';
import { RagController } from '../../../../src/interfaces/http/rag/rag.controller';
import type { HybridSearchUseCase } from '../../../../src/application/use-cases/rag/hybrid-search.use-case';
import type { ReindexProjectUseCase } from '../../../../src/application/use-cases/rag/reindex-project.use-case';
import type { IndexLocalFolderUseCase } from '../../../../src/application/use-cases/rag/index-local-folder.use-case';
import type { GetRagCoverageUseCase } from '../../../../src/application/use-cases/rag/get-rag-coverage.use-case';
import type { RecordRagFeedbackUseCase } from '../../../../src/application/use-cases/rag/record-rag-feedback.use-case';
import type { User } from '../../../../src/domain/iam/user.entity';
import type { AttachLocalFolderRequestDto } from '../../../../src/interfaces/http/rag/dto/rag.request.dto';

const USUARIO: User = {
  id: 'user-1',
  keycloakSub: null,
  email: 'owner@brabo.dev',
  name: 'Owner',
  locale: 'pt-BR',
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * `RagController.anexarPastaLocal` (RN-455, ADR 0113) — o controller só
 * repassa `projectId`/`user.id`/o corpo pro caso de uso, mesma forma de
 * `InternalRagController.buscar`. O teste cobre o QUE é repassado, não a
 * lógica de indexação (coberta em `index-local-folder.use-case.spec.ts`).
 */
describe('RagController', () => {
  function montarController(
    indexLocalFolder: Partial<IndexLocalFolderUseCase>,
    feedback: Partial<RecordRagFeedbackUseCase> = {},
  ) {
    return new RagController(
      {} as HybridSearchUseCase,
      {} as ReindexProjectUseCase,
      indexLocalFolder as IndexLocalFolderUseCase,
      {} as GetRagCoverageUseCase,
      feedback as RecordRagFeedbackUseCase,
    );
  }

  it('caminho feliz: repassa projectId, o id do usuário AUTENTICADO e o corpo pro caso de uso', async () => {
    const relatorioEsperado = {
      folderName: 'meu-projeto',
      filesIndexed: 2,
      filesSkipped: 0,
      chunksCreated: 3,
      embedding: { available: true, embedded: 3, skipped: 0 },
    };
    const execute = vi.fn().mockResolvedValue(relatorioEsperado);
    const controller = montarController({ execute });

    const body: AttachLocalFolderRequestDto = {
      folderName: 'meu-projeto',
      files: [{ path: 'README.md', content: '# Título' }],
    };

    const resultado = await controller.anexarPastaLocal(
      'proj-1',
      body,
      USUARIO,
    );

    expect(execute).toHaveBeenCalledWith(
      'proj-1',
      'user-1',
      'meu-projeto',
      body.files,
    );
    expect(resultado).toBe(relatorioEsperado);
  });

  it('CASO DE FALHA: o caso de uso lança (ex.: teto de arquivos) e o controller não engole o erro', async () => {
    const erro = new Error('teto de arquivos excedido');
    const execute = vi.fn().mockRejectedValue(erro);
    const controller = montarController({ execute });

    await expect(
      controller.anexarPastaLocal(
        'proj-1',
        { folderName: 'x', files: [] },
        USUARIO,
      ),
    ).rejects.toBe(erro);
  });
  // ------------------------------------------------------------- RN-480

  it('votar: repassa projectId, o corpo e o usuário AUTENTICADO como ator', async () => {
    // O ator do voto NUNCA vem do corpo: quem vota é quem está autenticado, e
    // um `actorId` vindo do cliente deixaria a unique por ator (um voto por
    // trecho por busca) contornável de fora.
    const execute = vi.fn().mockResolvedValue({
      searchId: 'b-1',
      chunkId: 'c-9',
      verdict: 'util',
      rank: 2,
    });
    const controller = montarController({}, { execute });

    const resultado = await controller.votar(
      'proj-1',
      { searchId: 'b-1', chunkId: 'c-9', verdict: 'util' },
      USUARIO,
    );

    expect(execute).toHaveBeenCalledWith({
      projectId: 'proj-1',
      searchId: 'b-1',
      chunkId: 'c-9',
      verdict: 'util',
      actor: { kind: 'user', id: 'user-1' },
    });
    expect(resultado).toEqual({
      searchId: 'b-1',
      chunkId: 'c-9',
      verdict: 'util',
      rank: 2,
    });
  });
});
