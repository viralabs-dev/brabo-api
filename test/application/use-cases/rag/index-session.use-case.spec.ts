import { describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { SessionRepository } from '../../../../src/application/ports/session-repository.port';
import type { SessionEventRepository } from '../../../../src/application/ports/session-event-repository.port';
import type { SessionEvent } from '../../../../src/domain/sessions/session-event.entity';
import type { Session } from '../../../../src/domain/sessions/session.entity';
import {
  ChunkRepository,
  type Chunk,
  type NewChunk,
} from '../../../../src/application/ports/chunk-repository.port';
import { RagEmbeddingService } from '../../../../src/application/use-cases/rag/rag-embedding.service';
import { IndexSessionUseCase } from '../../../../src/application/use-cases/rag/index-session.use-case';

class FakeChunkRepository extends ChunkRepository {
  created: NewChunk[] = [];
  deletedSessions: string[] = [];

  async create(input: NewChunk): Promise<Chunk> {
    return (await this.createMany([input]))[0];
  }
  createMany(inputs: NewChunk[]): Promise<Chunk[]> {
    this.created.push(...inputs);
    return Promise.resolve(
      inputs.map((input, i) => ({
        id: `chunk-${i}`,
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
  deleteByScope(): Promise<number> {
    return Promise.reject(new Error('não usado neste teste'));
  }
  deleteBySession(sessionId: string): Promise<number> {
    this.deletedSessions.push(sessionId);
    return Promise.resolve(0);
  }
  searchByVector(): Promise<never[]> {
    return Promise.reject(new Error('não usado neste teste'));
  }
  searchByLexicalQuery(): Promise<never[]> {
    return Promise.reject(new Error('não usado neste teste'));
  }
}

function fakeSessions(session: Session | null): SessionRepository {
  return {
    findInProject: () => Promise.resolve(session),
  } as unknown as SessionRepository;
}

function fakeEvents(
  porTipo: Record<string, SessionEvent[]>,
): SessionEventRepository {
  return {
    listByTypeInSession: (_sessionId: string, tipo: string) =>
      Promise.resolve(porTipo[tipo] ?? []),
  } as unknown as SessionEventRepository;
}

function embeddingServiceQueVetoriza(available: boolean) {
  return {
    embedMany: (texts: readonly string[]) =>
      Promise.resolve({
        vectors: available ? texts.map((_, i) => [i]) : texts.map(() => null),
        available,
        reason: available ? undefined : 'provider indisponível',
      }),
    embedQuery: () => {
      return Promise.reject(new Error('não usado neste teste'));
    },
  } as unknown as RagEmbeddingService;
}

const SESSAO = { id: 'sess-1' } as Session;

function mkEvento(overrides: Partial<SessionEvent>): SessionEvent {
  return {
    id: 'evt-1',
    sessionId: 'sess-1',
    seq: 1,
    type: 'chat.message',
    actor: { kind: 'user', id: 'user-1' },
    payload: { text: 'olá' },
    createdAt: new Date(),
    ...overrides,
  };
}

describe('IndexSessionUseCase', () => {
  it('indexa chat.message e agent.response, ordenados por seq, com sourceRef apontando ao evento', async () => {
    const repo = new FakeChunkRepository();
    const events = fakeEvents({
      'chat.message': [
        mkEvento({
          id: 'evt-2',
          seq: 2,
          payload: { text: 'segunda pergunta' },
        }),
        mkEvento({
          id: 'evt-1',
          seq: 1,
          payload: { text: 'primeira pergunta' },
        }),
      ],
      'agent.response': [
        mkEvento({
          id: 'evt-3',
          seq: 3,
          type: 'agent.response',
          actor: { kind: 'agent', id: 'po' },
          payload: { text: 'resposta do agente' },
        }),
      ],
    });
    const useCase = new IndexSessionUseCase(
      fakeSessions(SESSAO),
      events,
      repo,
      embeddingServiceQueVetoriza(true),
    );

    const relatorio = await useCase.execute('proj-1', 'sess-1');

    expect(relatorio.eventsScanned).toBe(3);
    expect(relatorio.chunksCreated).toBe(3);
    expect(relatorio.embedding).toEqual({
      available: true,
      embedded: 3,
      skipped: 0,
    });
    expect(repo.deletedSessions).toEqual(['sess-1']);

    expect(repo.created.map((c) => c.metadata!.sourceRef)).toEqual([
      'evt-1',
      'evt-2',
      'evt-3',
    ]);
    expect(
      repo.created.every(
        (c) => c.scope === 'session' && c.sessionId === 'sess-1',
      ),
    ).toBe(true);
  });

  it('evento sem payload.text é ignorado, não vira chunk vazio', async () => {
    const repo = new FakeChunkRepository();
    const events = fakeEvents({
      'chat.message': [mkEvento({ payload: { foo: 'bar' } })],
      'agent.response': [],
    });
    const useCase = new IndexSessionUseCase(
      fakeSessions(SESSAO),
      events,
      repo,
      embeddingServiceQueVetoriza(true),
    );

    const relatorio = await useCase.execute('proj-1', 'sess-1');

    expect(relatorio.chunksCreated).toBe(0);
  });

  it('CASO DE FALHA: sessão inexistente no projeto lança NotFoundException', async () => {
    const repo = new FakeChunkRepository();
    const useCase = new IndexSessionUseCase(
      fakeSessions(null),
      fakeEvents({}),
      repo,
      embeddingServiceQueVetoriza(true),
    );

    await expect(
      useCase.execute('proj-1', 'sess-inexistente'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.deletedSessions).toEqual([]);
  });
});
