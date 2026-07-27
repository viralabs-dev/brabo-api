import { Injectable, NotFoundException } from '@nestjs/common';
import { StoryRepository } from '../../ports/backlog-repository.port';
import { ModuleMapRepository } from '../../ports/module-map-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { assertReady } from '../../../domain/backlog/story-readiness';
import { assertModulesResolved } from '../../../domain/architecture/module-resolution';
import {
  assertTransition,
  type StoryStatus,
} from '../../../domain/backlog/story-state-machine';

/**
 * Transição de status de história validada NO DOMÍNIO. Para draft→ready aplica
 * a regra de prontidão (DoD/DoR/RF/regra) E a validação cruzada de arquitetura
 * (todos os módulos referenciados existem no module_map vigente) ANTES da
 * máquina de estados — story incompleta ou com módulo faltante não sai de
 * draft. moduleIds vazio passa (é pendência, não bloqueio).
 */
@Injectable()
export class TransitionStoryUseCase {
  constructor(
    private readonly stories: StoryRepository,
    private readonly moduleMaps: ModuleMapRepository,
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
      const current = await this.moduleMaps.findCurrent(projectId);
      assertModulesResolved(
        story.moduleIds,
        current?.modules.map((m) => m.name) ?? [],
      );
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
