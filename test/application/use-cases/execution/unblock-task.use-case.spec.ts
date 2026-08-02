import { describe, it, expect, beforeEach } from 'vitest';
import { UnblockTaskUseCase } from '../../../../src/application/use-cases/execution/unblock-task.use-case';
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
const USER = 'user-1';

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
    status: 'ready',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

class FakeTasks {
  unblocked: Task = makeTask();
  unblock(_id: string) {
    return Promise.resolve(this.unblocked);
  }
}

class FakeStories {
  story: Story | null = makeStory();
  findById() {
    return Promise.resolve(this.story);
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

let tasks: FakeTasks;
let stories: FakeStories;
let append: FakeAppend;
let outbox: FakeOutbox;
let useCase: UnblockTaskUseCase;

beforeEach(() => {
  tasks = new FakeTasks();
  stories = new FakeStories();
  append = new FakeAppend();
  outbox = new FakeOutbox();
  useCase = new UnblockTaskUseCase(
    tasks as unknown as TaskRepository,
    stories as unknown as StoryRepository,
    append as unknown as AppendSessionEventUseCase,
    outbox,
    uowStub,
  );
});

describe('UnblockTaskUseCase', () => {
  it('desbloqueia a task e emite backlog.task_unblocked', async () => {
    const task = await useCase.execute(PROJECT, SESSION, 'task-1', USER);

    expect(task.id).toBe('task-1');
    expect(append.calls).toEqual(['backlog.task_unblocked']);
  });

  describe('outbox task.became_claimable (Fase 12b — RN-047)', () => {
    it('story ready: emite outbox — a task volta pegável de fato', async () => {
      tasks.unblocked = makeTask({ id: 'task-1', storyId: 'story-1' });
      stories.story = makeStory({ status: 'ready', moduleIds: ['api', 'web'] });

      await useCase.execute(PROJECT, SESSION, 'task-1', USER);

      expect(outbox.calls).toHaveLength(1);
      expect(outbox.calls[0]).toMatchObject({
        aggregateType: 'task',
        aggregateId: 'task-1',
        eventType: 'task.became_claimable',
        payload: {
          taskId: 'task-1',
          modules: ['api', 'web'],
          cause: 'task_unblocked',
        },
      });
    });

    it('story draft: NÃO emite outbox — desbloquear não a torna pegável ainda', async () => {
      stories.story = makeStory({ status: 'draft' });

      await useCase.execute(PROJECT, SESSION, 'task-1', USER);

      expect(outbox.calls).toEqual([]);
    });

    it('story sumida (edge case): não quebra, apenas não emite', async () => {
      stories.story = null;

      await expect(
        useCase.execute(PROJECT, SESSION, 'task-1', USER),
      ).resolves.toBeTruthy();
      expect(outbox.calls).toEqual([]);
    });
  });
});
