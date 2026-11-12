import { describe, it, expect, beforeEach } from 'vitest';
import { CreateTaskUseCase } from '../../../../src/application/use-cases/backlog/create-task.use-case';
import type {
  StoryRepository,
  TaskRepository,
} from '../../../../src/application/ports/backlog-repository.port';
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
    rf: [],
    rnf: [],
    businessRuleIds: [],
    dod: [],
    dor: [],
    moduleIds: ['api'],
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
  story: Story | null = makeStory();
  findById() {
    return Promise.resolve(this.story);
  }
}

class FakeTasks {
  criadas: Array<{ module?: string | null; fundacao?: boolean }> = [];
  create(input: {
    storyId: string;
    title: string;
    description?: string;
    module?: string | null;
    fundacao?: boolean;
  }) {
    this.criadas.push(input);
    return Promise.resolve({
      id: 'task-1',
      storyId: input.storyId,
      title: input.title,
      description: input.description ?? '',
      status: 'todo',
      assignedTo: null,
      blocked: false,
      blockedReason: null,
      blockedOrigin: null,
      gateStatus: null,
      gateCorrectionCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Task);
  }
}

class FakeAppend {
  calls: string[] = [];
  actors: unknown[] = [];
  execute(_p: string, _s: string, input: { type: string; actor?: unknown }) {
    this.calls.push(input.type);
    this.actors.push(input.actor);
    return Promise.resolve({} as never);
  }
}

class FakeOutbox {
  calls: unknown[] = [];
  append(input: unknown) {
    this.calls.push(input);
    return Promise.resolve();
  }
}

let stories: FakeStories;
let tasks: FakeTasks;
let append: FakeAppend;
let outbox: FakeOutbox;
let useCase: CreateTaskUseCase;

beforeEach(() => {
  stories = new FakeStories();
  tasks = new FakeTasks();
  append = new FakeAppend();
  outbox = new FakeOutbox();
  useCase = new CreateTaskUseCase(
    tasks as unknown as TaskRepository,
    stories as unknown as StoryRepository,
    append as unknown as AppendSessionEventUseCase,
    outbox,
    uowStub,
  );
});

describe('CreateTaskUseCase', () => {
  it('cria a task sob a story e emite backlog.task_created', async () => {
    const task = await useCase.execute(PROJECT, SESSION, {
      storyId: 'story-1',
      title: 'implementar x',
    });

    expect(task.storyId).toBe('story-1');
    expect(append.calls).toEqual(['backlog.task_created']);
  });

  it('RN-1138: a tarefa do Dev Lead nasce fundação; a do PO não', async () => {
    await useCase.execute(PROJECT, SESSION, {
      storyId: 'story-1',
      title: 'a',
      actorId: 'dev_lead',
    });
    await useCase.execute(PROJECT, SESSION, { storyId: 'story-1', title: 'b' });

    expect(tasks.criadas.map((c) => c.fundacao)).toEqual([true, false]);
  });

  it('o ator do evento é po por padrão e dev_lead quando informado', async () => {
    await useCase.execute(PROJECT, SESSION, { storyId: 'story-1', title: 't' });
    await useCase.execute(PROJECT, SESSION, {
      storyId: 'story-1',
      title: 't',
      actorId: 'dev_lead',
    });
    expect(append.actors).toEqual([
      { kind: 'agent', id: 'po' },
      { kind: 'agent', id: 'dev_lead' },
    ]);
  });

  it('story inexistente ou de outro projeto: rejeita', async () => {
    stories.story = null;
    await expect(
      useCase.execute(PROJECT, SESSION, { storyId: 'story-x', title: 't' }),
    ).rejects.toThrow();
  });

  describe('módulo gravado na criação (AT-912, RN-1085)', () => {
    it('com module da história: grava e o wake vai SÓ a esse módulo', async () => {
      stories.story = makeStory({ status: 'ready', moduleIds: ['api', 'web'] });
      await useCase.execute(PROJECT, SESSION, {
        storyId: 'story-1',
        title: 't',
        module: 'web',
      });
      expect(tasks.criadas[0].module).toBe('web');
      expect(outbox.calls[0]).toMatchObject({ payload: { modules: ['web'] } });
    });

    it('module fora da história: 400 nomeado e nada gravado', async () => {
      stories.story = makeStory({ moduleIds: ['api'] });
      await expect(
        useCase.execute(PROJECT, SESSION, {
          storyId: 'story-1',
          title: 't',
          module: 'db',
        }),
      ).rejects.toThrow(/módulo "db" não é da história/);
      expect(tasks.criadas).toEqual([]);
    });

    it('sem module e história de UM módulo: herda', async () => {
      stories.story = makeStory({ moduleIds: ['api'] });
      await useCase.execute(PROJECT, SESSION, {
        storyId: 'story-1',
        title: 't',
      });
      expect(tasks.criadas[0].module).toBe('api');
    });

    it('sem module e história de vários (o caso do PO): segue sem módulo', async () => {
      stories.story = makeStory({ moduleIds: ['api', 'web'] });
      await useCase.execute(PROJECT, SESSION, {
        storyId: 'story-1',
        title: 't',
      });
      expect(tasks.criadas[0].module).toBeNull();
    });
  });

  describe('outbox task.became_claimable (Fase 12b — RN-047)', () => {
    it('story já ready: emite outbox — task nasce pegável', async () => {
      stories.story = makeStory({ status: 'ready', moduleIds: ['api', 'web'] });

      await useCase.execute(PROJECT, SESSION, {
        storyId: 'story-1',
        title: 'implementar x',
      });

      expect(outbox.calls).toHaveLength(1);
      expect(outbox.calls[0]).toMatchObject({
        aggregateType: 'task',
        aggregateId: 'task-1',
        eventType: 'task.became_claimable',
        payload: {
          taskId: 'task-1',
          modules: ['api', 'web'],
          cause: 'task_created',
        },
      });
    });

    it('story draft: NÃO emite outbox — a task ainda não é pegável', async () => {
      stories.story = makeStory({ status: 'draft' });

      await useCase.execute(PROJECT, SESSION, {
        storyId: 'story-1',
        title: 'implementar x',
      });

      expect(outbox.calls).toEqual([]);
    });
  });
});
