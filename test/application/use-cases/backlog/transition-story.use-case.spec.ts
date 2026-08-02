import { describe, it, expect, beforeEach } from 'vitest';
import { TransitionStoryUseCase } from '../../../../src/application/use-cases/backlog/transition-story.use-case';
import { StoryNotReadyError } from '../../../../src/domain/backlog/story-readiness';
import { InvalidStoryTransitionError } from '../../../../src/domain/backlog/story-state-machine';
import type {
  StoryRepository,
  TaskRepository,
} from '../../../../src/application/ports/backlog-repository.port';
import type { ModuleMapRepository } from '../../../../src/application/ports/module-map-repository.port';
import type { ModuleMap } from '../../../../src/domain/architecture/module-map.entity';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type {
  Story,
  Task,
} from '../../../../src/domain/backlog/backlog.entity';

// Reentrante e passa-direto, como o DrizzleUnitOfWork quando já há tx ativa.
const uowStub = {
  runInTransaction: <T>(work: () => Promise<T>) => work(),
};

const PROJECT = 'p1';
const SESSION = 's1';

function makeStory(overrides: Partial<Story> = {}): Story {
  return {
    id: 'story-1',
    epicId: 'epic-1',
    projectId: PROJECT,
    sessionId: SESSION,
    title: 't',
    description: '',
    rf: ['rf'],
    rnf: [],
    businessRuleIds: ['evt-r1'],
    dod: ['dod'],
    dor: ['dor'],
    moduleIds: [],
    status: 'draft',
    proposedReady: false,
    returnedReason: null,
    returnedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

class FakeStories {
  story: Story = makeStory();
  updated: string | null = null;
  findById() {
    return Promise.resolve(this.story);
  }
  updateStatus(_id: string, status: string) {
    this.updated = status;
    return Promise.resolve(
      makeStory({ ...this.story, status: status as Story['status'] }),
    );
  }
}

class FakeAppend {
  calls: string[] = [];
  actors: { kind: string; id: string }[] = [];
  execute(
    _p: string,
    _s: string,
    input: { type: string; actor: { kind: string; id: string } },
  ) {
    this.calls.push(input.type);
    this.actors.push(input.actor);
    return Promise.resolve({} as never);
  }
}

class FakeModuleMaps {
  current: ModuleMap | null = null;
  findCurrent() {
    return Promise.resolve(this.current);
  }
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    storyId: 'story-1',
    title: 't',
    description: '',
    status: 'todo',
    assignedTo: null,
    blocked: false,
    blockedReason: null,
    blockedOrigin: null,
    gateStatus: null,
    gateCorrectionCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

class FakeTasks {
  byStory: Task[] = [];
  findByStoryIds(_storyIds: string[]) {
    return Promise.resolve(this.byStory);
  }
}

class FakeOutbox {
  calls: {
    aggregateType: string;
    eventType: string;
    aggregateId: string;
    payload: unknown;
  }[] = [];
  append(input: {
    aggregateType: string;
    eventType: string;
    aggregateId: string;
    payload: unknown;
  }) {
    this.calls.push(input);
    return Promise.resolve();
  }
}

let stories: FakeStories;
let moduleMaps: FakeModuleMaps;
let append: FakeAppend;
let tasks: FakeTasks;
let outbox: FakeOutbox;
let useCase: TransitionStoryUseCase;

beforeEach(() => {
  stories = new FakeStories();
  moduleMaps = new FakeModuleMaps();
  append = new FakeAppend();
  tasks = new FakeTasks();
  outbox = new FakeOutbox();
  useCase = new TransitionStoryUseCase(
    stories as unknown as StoryRepository,
    moduleMaps as unknown as ModuleMapRepository,
    append as unknown as AppendSessionEventUseCase,
    tasks as unknown as TaskRepository,
    outbox,
    uowStub,
  );
});

describe('TransitionStoryUseCase', () => {
  it('draft→ready sem DoD é rejeitada (regra de domínio)', async () => {
    stories.story = makeStory({ dod: [] });
    await expect(
      useCase.execute(PROJECT, SESSION, 'story-1', 'ready'),
    ).rejects.toBeInstanceOf(StoryNotReadyError);
    expect(stories.updated).toBeNull();
  });

  it('draft→ready com tudo completo passa', async () => {
    const updated = await useCase.execute(PROJECT, SESSION, 'story-1', 'ready');
    expect(updated.status).toBe('ready');
    expect(stories.updated).toBe('ready');
    expect(append.calls).toEqual(['backlog.story_transitioned']);
  });

  it('draft→ready bloqueada quando a story referencia módulo inexistente', async () => {
    stories.story = makeStory({ moduleIds: ['api', 'fantasma'] });
    moduleMaps.current = {
      id: 'mm1',
      projectId: PROJECT,
      sessionId: SESSION,
      version: 1,
      modules: [
        { name: 'api', stack: 'ts', responsibility: 'x', dependsOn: [] },
      ],
      createdAt: new Date(),
    };
    await expect(
      useCase.execute(PROJECT, SESSION, 'story-1', 'ready'),
    ).rejects.toMatchObject({ name: 'StoryModulesMissingError' });
    expect(stories.updated).toBeNull();
  });

  it('draft→ready passa quando todos os módulos existem', async () => {
    stories.story = makeStory({ moduleIds: ['api'] });
    moduleMaps.current = {
      id: 'mm1',
      projectId: PROJECT,
      sessionId: SESSION,
      version: 1,
      modules: [
        { name: 'api', stack: 'ts', responsibility: 'x', dependsOn: [] },
      ],
      createdAt: new Date(),
    };
    const updated = await useCase.execute(PROJECT, SESSION, 'story-1', 'ready');
    expect(updated.status).toBe('ready');
  });

  it('draft→in_progress é transição inválida', async () => {
    await expect(
      useCase.execute(PROJECT, SESSION, 'story-1', 'in_progress'),
    ).rejects.toBeInstanceOf(InvalidStoryTransitionError);
  });

  describe('quem promoveu (Fase 12c — RN-048)', () => {
    it('sem ator explícito o evento continua sendo do PO', async () => {
      await useCase.execute(PROJECT, SESSION, 'story-1', 'ready');
      expect(append.actors).toEqual([{ kind: 'agent', id: 'po' }]);
    });

    it('promoção do usuário grava o USUÁRIO no evento, não o PO', async () => {
      // O event log é imutável e é o que a auditoria lê: registrar `agent/po`
      // numa promoção que foi decisão do usuário apagaria exatamente o passo
      // humano que a Fase 12c existe para devolver.
      await useCase.execute(PROJECT, SESSION, 'story-1', 'ready', {
        kind: 'user',
        id: 'u-42',
      });
      expect(append.actors).toEqual([{ kind: 'user', id: 'u-42' }]);
    });
  });

  describe('outbox task.became_claimable (Fase 12b — RN-047)', () => {
    it('→ready: uma linha por task todo/não-bloqueada da story', async () => {
      stories.story = makeStory({ moduleIds: ['api', 'web'] });
      moduleMaps.current = {
        id: 'mm1',
        projectId: PROJECT,
        sessionId: SESSION,
        version: 1,
        modules: [
          { name: 'api', stack: 'ts', responsibility: 'x', dependsOn: [] },
          { name: 'web', stack: 'ts', responsibility: 'x', dependsOn: [] },
        ],
        createdAt: new Date(),
      };
      tasks.byStory = [
        makeTask({ id: 't1', status: 'todo', blocked: false }),
        makeTask({ id: 't2', status: 'todo', blocked: false }),
      ];

      await useCase.execute(PROJECT, SESSION, 'story-1', 'ready');

      expect(outbox.calls).toHaveLength(2);
      expect(outbox.calls[0]).toMatchObject({
        aggregateType: 'task',
        eventType: 'task.became_claimable',
        aggregateId: 't1',
        payload: {
          taskId: 't1',
          modules: ['api', 'web'],
          cause: 'story_ready',
        },
      });
      expect(outbox.calls[1]).toMatchObject({
        aggregateType: 'task',
        eventType: 'task.became_claimable',
        aggregateId: 't2',
        payload: {
          taskId: 't2',
          modules: ['api', 'web'],
          cause: 'story_ready',
        },
      });
    });

    it('→ready: task done/in_progress/bloqueada não gera linha nenhuma', async () => {
      tasks.byStory = [
        makeTask({ id: 't1', status: 'done' }),
        makeTask({ id: 't2', status: 'in_progress' }),
        makeTask({ id: 't3', status: 'todo', blocked: true }),
      ];

      await useCase.execute(PROJECT, SESSION, 'story-1', 'ready');

      expect(outbox.calls).toEqual([]);
    });

    it('transição que não é →ready não toca o outbox', async () => {
      stories.story = makeStory({ status: 'ready' });
      tasks.byStory = [makeTask()];

      await useCase.execute(PROJECT, SESSION, 'story-1', 'in_progress');

      expect(outbox.calls).toEqual([]);
    });
  });
});
