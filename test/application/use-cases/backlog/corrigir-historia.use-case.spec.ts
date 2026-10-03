import { describe, it, expect, beforeEach } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CorrigirHistoriaUseCase } from '../../../../src/application/use-cases/backlog/corrigir-historia.use-case';
import type {
  StoryRepository,
  TaskRepository,
} from '../../../../src/application/ports/backlog-repository.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type {
  Story,
  Task,
} from '../../../../src/domain/backlog/backlog.entity';

/**
 * RN-727 (ADR 0212): editar título e arquivar história — só `draft`, sem
 * tarefa em execução, recusa nomeada em 409, evento novo e nada apagado.
 */
function makeStory(over: Partial<Story> = {}): Story {
  return {
    id: 'st-1',
    epicId: 'e1',
    projectId: 'p1',
    sessionId: 's1',
    title: 'Cadastrar usu\\u00e1rio',
    description: '',
    rf: [],
    rnf: [],
    businessRuleIds: [],
    dod: [],
    dor: [],
    moduleIds: [],
    status: 'draft',
    proposedReady: false,
    returnedReason: null,
    returnedAt: null,
    archivedAt: null,
    archivedReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function makeTask(status: Task['status']): Task {
  return {
    id: `t-${status}`,
    storyId: 'st-1',
    title: 't',
    description: '',
    status,
    assignedTo: null,
    blocked: false,
    blockedReason: null,
    blockedOrigin: null,
    gateStatus: null,
    gateCorrectionCount: 0,
    module: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

let story: Story | null;
let tarefas: Task[];
let eventos: {
  sessionId: string;
  type: string;
  actor: unknown;
  payload: any;
}[];
let gravado: Record<string, unknown> | null;
let useCase: CorrigirHistoriaUseCase;

beforeEach(() => {
  story = makeStory();
  tarefas = [makeTask('todo')];
  eventos = [];
  gravado = null;
  const stories = {
    findById: () => Promise.resolve(story),
    updateText: (_id: string, text: Record<string, unknown>) => {
      gravado = text;
      return Promise.resolve(makeStory(text));
    },
    archive: (_id: string, reason: string | null) => {
      gravado = { reason };
      return Promise.resolve(
        makeStory({ archivedAt: new Date(), archivedReason: reason }),
      );
    },
  };
  const tasks = { findByStoryIds: () => Promise.resolve(tarefas) };
  const append = {
    execute: (
      _p: string,
      sessionId: string,
      input: { type: string; actor: unknown; payload: unknown },
    ) => {
      eventos.push({ sessionId, ...input });
      return Promise.resolve({});
    },
  };
  const uow = { runInTransaction: <T>(w: () => Promise<T>) => w() };
  useCase = new CorrigirHistoriaUseCase(
    stories as unknown as StoryRepository,
    tasks as unknown as TaskRepository,
    append as unknown as AppendSessionEventUseCase,
    uow,
  );
});

describe('CorrigirHistoriaUseCase (RN-727)', () => {
  it('edita o título e grava backlog.story_updated com o antes e o depois', async () => {
    const r = await useCase.editar(
      'p1',
      'st-1',
      { title: '  Cadastrar usuário ' },
      { kind: 'user', id: 'u1' },
    );
    expect(r.title).toBe('Cadastrar usuário');
    expect(gravado).toEqual({ title: 'Cadastrar usuário', description: '' });
    expect(eventos).toEqual([
      {
        sessionId: 's1',
        type: 'backlog.story_updated',
        actor: { kind: 'user', id: 'u1' },
        payload: {
          storyId: 'st-1',
          previousTitle: 'Cadastrar usu\\u00e1rio',
          title: 'Cadastrar usuário',
          descriptionChanged: false,
        },
      },
    ]);
  });

  it('nada mudou: nenhuma escrita e nenhum evento', async () => {
    await useCase.editar(
      'p1',
      'st-1',
      { title: story!.title },
      { kind: 'agent', id: 'po' },
    );
    expect(gravado).toBeNull();
    expect(eventos).toEqual([]);
  });

  it('título vazio é 400', async () => {
    await expect(
      useCase.editar(
        'p1',
        'st-1',
        { title: '  ' },
        { kind: 'agent', id: 'po' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('arquiva, guarda o motivo e diz quais tarefas saíram junto', async () => {
    const r = await useCase.arquivar('p1', 'st-1', ' duplicada ', {
      kind: 'agent',
      id: 'po',
    });
    expect(r.archivedAt).toBeInstanceOf(Date);
    expect(gravado).toEqual({ reason: 'duplicada' });
    expect(eventos[0]).toMatchObject({
      type: 'backlog.story_archived',
      actor: { kind: 'agent', id: 'po' },
      payload: { storyId: 'st-1', reason: 'duplicada', taskIds: ['t-todo'] },
    });
  });

  it.each<Task['status']>(['in_progress', 'in_review'])(
    'tarefa %s recusa com 409 historia_com_tarefa_em_execucao, sem escrever',
    async (status) => {
      tarefas = [makeTask('todo'), makeTask(status)];
      const erro = await useCase
        .arquivar('p1', 'st-1', null, { kind: 'user', id: 'u1' })
        .catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(ConflictException);
      expect((erro as ConflictException).getResponse()).toMatchObject({
        reason: 'historia_com_tarefa_em_execucao',
      });
      expect(gravado).toBeNull();
      expect(eventos).toEqual([]);
    },
  );

  it('história não draft recusa com historia_nao_draft', async () => {
    story = makeStory({ status: 'ready' });
    const erro = await useCase
      .editar('p1', 'st-1', { title: 'x' }, { kind: 'user', id: 'u1' })
      .catch((e: unknown) => e);
    expect((erro as ConflictException).getResponse()).toMatchObject({
      reason: 'historia_nao_draft',
    });
  });

  it('já arquivada recusa com historia_arquivada', async () => {
    story = makeStory({ archivedAt: new Date() });
    const erro = await useCase
      .arquivar('p1', 'st-1', null, { kind: 'user', id: 'u1' })
      .catch((e: unknown) => e);
    expect((erro as ConflictException).getResponse()).toMatchObject({
      reason: 'historia_arquivada',
    });
  });

  it('história de outro projeto é 404', async () => {
    story = makeStory({ projectId: 'outro' });
    await expect(
      useCase.arquivar('p1', 'st-1', null, { kind: 'user', id: 'u1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
