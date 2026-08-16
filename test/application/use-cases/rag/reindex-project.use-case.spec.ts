import { describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { ProjectRepository } from '../../../../src/application/ports/project-repository.port';
import type { SessionRepository } from '../../../../src/application/ports/session-repository.port';
import type { Project } from '../../../../src/domain/iam/project.entity';
import type { Session } from '../../../../src/domain/sessions/session.entity';
import type { IndexProjectDocsUseCase } from '../../../../src/application/use-cases/rag/index-project-docs.use-case';
import type { IndexSessionUseCase } from '../../../../src/application/use-cases/rag/index-session.use-case';
import { ReindexProjectUseCase } from '../../../../src/application/use-cases/rag/reindex-project.use-case';

function fakeProjects(project: Project | null): ProjectRepository {
  return { findById: async () => project } as unknown as ProjectRepository;
}

function fakeSessions(sessions: Session[]): SessionRepository {
  return { listForProject: async () => sessions } as unknown as SessionRepository;
}

const PROJETO = { id: 'proj-1' } as Project;

describe('ReindexProjectUseCase', () => {
  it('roda docs+adr uma vez e uma indexação de sessão por sessão do projeto, agregando os relatórios', async () => {
    const docsReport = {
      filesScanned: 2,
      docsChunks: 1,
      adrChunks: 1,
      truncated: false,
      embedding: { available: true, embedded: 2, skipped: 0 },
    };
    const chamadasDeSessao: string[] = [];
    const indexDocs = { execute: async () => docsReport } as unknown as IndexProjectDocsUseCase;
    const indexSession = {
      execute: async (_projectId: string, sessionId: string) => {
        chamadasDeSessao.push(sessionId);
        return {
          eventsScanned: 2,
          chunksCreated: sessionId === 'sess-vazia' ? 0 : 3,
          embedding: { available: true, embedded: 3, skipped: 0 },
        };
      },
    } as unknown as IndexSessionUseCase;

    const useCase = new ReindexProjectUseCase(
      fakeProjects(PROJETO),
      fakeSessions([{ id: 'sess-1' } as Session, { id: 'sess-vazia' } as Session]),
      indexDocs,
      indexSession,
    );

    const relatorio = await useCase.execute('proj-1');

    expect(chamadasDeSessao).toEqual(['sess-1', 'sess-vazia']);
    expect(relatorio.docs).toEqual(docsReport);
    expect(relatorio.sessions).toEqual({ total: 2, indexed: 1, chunksCreated: 3 });
    expect(relatorio.embeddingAvailable).toBe(true);
  });

  it('embeddingAvailable é false quando docs OU alguma sessão não conseguiu vetorizar', async () => {
    const indexDocs = {
      execute: async () => ({
        filesScanned: 0,
        docsChunks: 0,
        adrChunks: 0,
        truncated: false,
        embedding: { available: true, embedded: 0, skipped: 0 },
      }),
    } as unknown as IndexProjectDocsUseCase;
    const indexSession = {
      execute: async () => ({
        eventsScanned: 1,
        chunksCreated: 1,
        embedding: { available: false, embedded: 0, skipped: 1, reason: 'sem provider' },
      }),
    } as unknown as IndexSessionUseCase;

    const useCase = new ReindexProjectUseCase(
      fakeProjects(PROJETO),
      fakeSessions([{ id: 'sess-1' } as Session]),
      indexDocs,
      indexSession,
    );

    const relatorio = await useCase.execute('proj-1');

    expect(relatorio.embeddingAvailable).toBe(false);
    expect(relatorio.embeddingReason).toBe('sem provider');
  });

  it('CASO DE FALHA: projeto inexistente lança NotFoundException', async () => {
    const useCase = new ReindexProjectUseCase(
      fakeProjects(null),
      fakeSessions([]),
      {} as IndexProjectDocsUseCase,
      {} as IndexSessionUseCase,
    );

    await expect(useCase.execute('proj-inexistente')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
