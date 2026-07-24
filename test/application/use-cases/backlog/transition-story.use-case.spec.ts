import { describe, it, expect, beforeEach } from 'vitest';
import { TransitionStoryUseCase } from '../../../../src/application/use-cases/backlog/transition-story.use-case';
import { StoryNotReadyError } from '../../../../src/domain/backlog/story-readiness';
import { InvalidStoryTransitionError } from '../../../../src/domain/backlog/story-state-machine';
import type { StoryRepository } from '../../../../src/application/ports/backlog-repository.port';
import type { ModuleMapRepository } from '../../../../src/application/ports/module-map-repository.port';
import type { ModuleMap } from '../../../../src/domain/architecture/module-map.entity';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { Story } from '../../../../src/domain/backlog/backlog.entity';

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
  execute(_p: string, _s: string, input: { type: string }) {
    this.calls.push(input.type);
    return Promise.resolve({} as never);
  }
}

class FakeModuleMaps {
  current: ModuleMap | null = null;
  findCurrent() {
    return Promise.resolve(this.current);
  }
}

let stories: FakeStories;
let moduleMaps: FakeModuleMaps;
let append: FakeAppend;
let useCase: TransitionStoryUseCase;

beforeEach(() => {
  stories = new FakeStories();
  moduleMaps = new FakeModuleMaps();
  append = new FakeAppend();
  useCase = new TransitionStoryUseCase(
    stories as unknown as StoryRepository,
    moduleMaps as unknown as ModuleMapRepository,
    append as unknown as AppendSessionEventUseCase,
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
});
