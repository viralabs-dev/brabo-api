import { describe, it, expect, beforeEach } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CompleteStoryUseCase } from '../../../../src/application/use-cases/backlog/complete-story.use-case';
import type { StoryRepository } from '../../../../src/application/ports/backlog-repository.port';
import type { SessionEventRepository } from '../../../../src/application/ports/session-event-repository.port';
import type { ProjectRepository } from '../../../../src/application/ports/project-repository.port';
import type { ModuleMapRepository } from '../../../../src/application/ports/module-map-repository.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { Story } from '../../../../src/domain/backlog/backlog.entity';
import type { SessionEvent } from '../../../../src/domain/sessions/session-event.entity';

const PROJECT = 'p1';
const SESSION = 's1';

function makeStory(overrides: Partial<Story> = {}): Story {
  return {
    id: 'story-1',
    epicId: 'epic-1',
    projectId: PROJECT,
    sessionId: SESSION,
    title: 'Pagar com cartão',
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
  updateContent(_id: string, content: Partial<Story>) {
    this.story = makeStory({ ...this.story!, ...content });
    return Promise.resolve(this.story);
  }
  updateStatus(_id: string, status: Story['status']) {
    this.story = makeStory({ ...this.story!, status });
    return Promise.resolve(this.story);
  }
  setProposedReady(_id: string, proposedReady: boolean) {
    this.story = makeStory({ ...this.story!, proposedReady });
    return Promise.resolve(this.story);
  }
}

describe('CompleteStoryUseCase (RN-720)', () => {
  let stories: FakeStories;
  let eventos: string[];
  let modo: 'auto' | 'manual';
  let useCase: CompleteStoryUseCase;

  beforeEach(() => {
    stories = new FakeStories();
    eventos = [];
    modo = 'manual';
    const regra = { id: 'rule-1', type: 'artifact.business_rule' };
    useCase = new CompleteStoryUseCase(
      stories as unknown as StoryRepository,
      {
        findById: (id: string) =>
          Promise.resolve(id === 'rule-1' ? (regra as SessionEvent) : null),
      } as unknown as SessionEventRepository,
      {
        execute: (_p: string, _s: string, e: { type: string }) => {
          eventos.push(e.type);
          return Promise.resolve({});
        },
      } as unknown as AppendSessionEventUseCase,
      {
        findById: () => Promise.resolve({ storyPromotion: modo }),
      } as unknown as ProjectRepository,
      {
        findCurrent: () => Promise.resolve(null),
      } as unknown as ModuleMapRepository,
    );
  });

  const completa = {
    storyId: 'story-1',
    rf: ['RF1'],
    dod: ['testes verdes'],
    dor: ['regra clara'],
    businessRuleIds: ['rule-1'],
  };

  it('liga a regra, completa os campos e propõe a promoção em modo manual', async () => {
    const story = await useCase.execute(PROJECT, SESSION, completa);
    expect(story.businessRuleIds).toEqual(['rule-1']);
    expect(story.proposedReady).toBe(true);
    expect(story.status).toBe('draft');
    expect(eventos).toEqual([
      'backlog.story_promotion_proposed',
      'backlog.story_completed',
    ]);
  });

  it('promove a ready em modo auto, pelo mesmo critério de create_story', async () => {
    modo = 'auto';
    const story = await useCase.execute(PROJECT, SESSION, completa);
    expect(story.status).toBe('ready');
  });

  it('história ainda incompleta fica draft sem proposta', async () => {
    const story = await useCase.execute(PROJECT, SESSION, {
      storyId: 'story-1',
      businessRuleIds: ['rule-1'],
    });
    expect(story.status).toBe('draft');
    expect(story.proposedReady).toBe(false);
    expect(eventos).toEqual(['backlog.story_completed']);
  });

  it('recusa regra inexistente sem gravar nada', async () => {
    await expect(
      useCase.execute(PROJECT, SESSION, {
        ...completa,
        businessRuleIds: ['inventada'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(stories.story!.businessRuleIds).toEqual([]);
  });

  it('recusa história de outro projeto e história já ready', async () => {
    stories.story = makeStory({ projectId: 'outro' });
    await expect(
      useCase.execute(PROJECT, SESSION, completa),
    ).rejects.toBeInstanceOf(NotFoundException);
    stories.story = makeStory({ status: 'ready' });
    await expect(
      useCase.execute(PROJECT, SESSION, completa),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
