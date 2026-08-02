import { Injectable, NotFoundException } from '@nestjs/common';
import {
  StoryRepository,
  TaskRepository,
} from '../../ports/backlog-repository.port';
import { ModuleMapRepository } from '../../ports/module-map-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { UnitOfWork } from '../../ports/unit-of-work.port';
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
    private readonly tasks: TaskRepository,
    private readonly outbox: OutboxRepository,
    private readonly unitOfWork: UnitOfWork,
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

    // Promoção e wakes na MESMA transação (D7): commitar a story como `ready`
    // sem as linhas de outbox deixa um lote inteiro de tasks pegáveis sem
    // ninguém avisado — e o agente idle só descobriria por acaso, no próximo
    // evento não relacionado.
    return this.unitOfWork.runInTransaction(async () => {
      const updated = await this.stories.updateStatus(storyId, to);

      await this.appendEvent.execute(projectId, sessionId, {
        type: 'backlog.story_transitioned',
        actor: { kind: 'agent', id: 'po' },
        payload: { storyId, from: story.status, to },
      });

      // Fase 12b (RN-047, ADR 0045): promover a `ready` libera de uma vez o
      // lote de tasks já criadas sob ela — uma linha de outbox por task
      // pegável, pra cada dev agent idle do módulo acordar e reivindicar.
      if (to === 'ready') {
        const claimable = (await this.tasks.findByStoryIds([storyId])).filter(
          (t) => t.status === 'todo' && !t.blocked,
        );

        for (const task of claimable) {
          await this.outbox.append({
            aggregateType: 'task',
            aggregateId: task.id,
            eventType: 'task.became_claimable',
            payload: {
              projectId,
              sessionId,
              taskId: task.id,
              modules: story.moduleIds,
              cause: 'story_ready',
            },
          });
        }
      }

      return updated;
    });
  }
}
