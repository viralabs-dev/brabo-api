import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { CreateStoryUseCase } from '../../../../src/application/use-cases/backlog/create-story.use-case';
import type {
  StoryRepository,
  EpicRepository,
} from '../../../../src/application/ports/backlog-repository.port';
import type { SessionEventRepository } from '../../../../src/application/ports/session-event-repository.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type {
  Story,
  Epic,
} from '../../../../src/domain/backlog/backlog.entity';
import type { SessionEvent } from '../../../../src/domain/sessions/session-event.entity';

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
    status: 'draft',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

class FakeEpics {
  epic: Epic | null = {
    id: 'epic-1',
    projectId: PROJECT,
    sessionId: SESSION,
    title: 'e',
    description: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  findById() {
    return Promise.resolve(this.epic);
  }
}

class FakeStories {
  created: Story | null = null;
  status: string | null = null;
  create(input: Partial<Story>) {
    this.created = makeStory({ ...input, id: 'story-1' });
    return Promise.resolve(this.created);
  }
  updateStatus(_id: string, status: string) {
    this.status = status;
    this.created = makeStory({
      ...this.created!,
      status: status as Story['status'],
    });
    return Promise.resolve(this.created);
  }
}

class FakeEvents {
  byId: Record<string, SessionEvent> = {};
  findById(id: string) {
    return Promise.resolve(this.byId[id] ?? null);
  }
}

class FakeAppend {
  calls: string[] = [];
  execute(_p: string, _s: string, input: { type: string }) {
    this.calls.push(input.type);
    return Promise.resolve({} as never);
  }
}

function ruleEvent(id: string): SessionEvent {
  return {
    id,
    sessionId: SESSION,
    seq: 1,
    type: 'artifact.business_rule',
    actor: { kind: 'agent', id: 'criativo' },
    payload: { title: 'regra' },
    createdAt: new Date(),
  };
}

let epics: FakeEpics;
let stories: FakeStories;
let events: FakeEvents;
let append: FakeAppend;
let useCase: CreateStoryUseCase;

beforeEach(() => {
  epics = new FakeEpics();
  stories = new FakeStories();
  events = new FakeEvents();
  append = new FakeAppend();
  useCase = new CreateStoryUseCase(
    stories as unknown as StoryRepository,
    epics as unknown as EpicRepository,
    events as unknown as SessionEventRepository,
    append as unknown as AppendSessionEventUseCase,
  );
});

describe('CreateStoryUseCase', () => {
  it('recusa business_rule_id inexistente — nada é criado', async () => {
    await expect(
      useCase.execute(PROJECT, SESSION, {
        epicId: 'epic-1',
        title: 'Cadastro',
        businessRuleIds: ['nao-existe'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(stories.created).toBeNull();
    expect(append.calls).toHaveLength(0);
  });

  it('recusa id que existe mas NÃO é artifact.business_rule', async () => {
    events.byId['evt-x'] = { ...ruleEvent('evt-x'), type: 'chat.message' };
    await expect(
      useCase.execute(PROJECT, SESSION, {
        epicId: 'epic-1',
        title: 'x',
        businessRuleIds: ['evt-x'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('story completa é criada e promovida a ready', async () => {
    events.byId['evt-r1'] = ruleEvent('evt-r1');
    const story = await useCase.execute(PROJECT, SESSION, {
      epicId: 'epic-1',
      title: 'Cadastro',
      rf: ['permitir cadastro'],
      dod: ['testes'],
      dor: ['aceite'],
      businessRuleIds: ['evt-r1'],
    });
    expect(story.status).toBe('ready');
    expect(stories.status).toBe('ready');
    expect(append.calls).toEqual(['backlog.story_created']);
  });

  it('story incompleta permanece draft', async () => {
    events.byId['evt-r1'] = ruleEvent('evt-r1');
    const story = await useCase.execute(PROJECT, SESSION, {
      epicId: 'epic-1',
      title: 'Sem DoD',
      rf: ['rf'],
      dor: ['aceite'],
      businessRuleIds: ['evt-r1'],
      // sem dod
    });
    expect(story.status).toBe('draft');
    expect(stories.status).toBeNull();
  });

  it('recusa épico inexistente no projeto', async () => {
    epics.epic = null;
    await expect(
      useCase.execute(PROJECT, SESSION, { epicId: 'nope', title: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
