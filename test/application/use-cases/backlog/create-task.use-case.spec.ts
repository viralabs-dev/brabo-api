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
  create(input: { storyId: string; title: string; description?: string }) {
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
  execute(_p: string, _s: string, input: { type: string }) {
    this.calls.push(input.type);
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

  it('story inexistente ou de outro projeto: rejeita', async () => {
    stories.story = null;
    await expect(
      useCase.execute(PROJECT, SESSION, { storyId: 'story-x', title: 't' }),
    ).rejects.toThrow();
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
