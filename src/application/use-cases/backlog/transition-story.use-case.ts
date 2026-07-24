import { Injectable, NotFoundException } from '@nestjs/common';
import { StoryRepository } from '../../ports/backlog-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { assertReady } from '../../../domain/backlog/story-readiness';
import {
  assertTransition,
  type StoryStatus,
} from '../../../domain/backlog/story-state-machine';

/**
 * Transição de status de história validada NO DOMÍNIO. Para draft→ready aplica
 * a regra de prontidão (DoD/DoR/RF/regra) ANTES da máquina de estados — story
 * incompleta não sai de draft. Também disponível pra transições futuras
 * (in_progress/done).
 */
@Injectable()
export class TransitionStoryUseCase {
  constructor(
    private readonly stories: StoryRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    storyId: string,
    to: StoryStatus,
  ) {
    const story = await this.stories.findById(storyId);
    if (!story || story.projectId !== projectId) {
      throw new NotFoundException('História não encontrada');
    }

    if (to === 'ready') {
      assertReady(story);
    }
    assertTransition(story.status, to);

    const updated = await this.stories.updateStatus(storyId, to);

    await this.appendEvent.execute(projectId, sessionId, {
      type: 'backlog.story_transitioned',
      actor: { kind: 'agent', id: 'po' },
      payload: { storyId, from: story.status, to },
    });

    return updated;
  }
}
