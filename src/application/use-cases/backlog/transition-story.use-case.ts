import { Injectable, NotFoundException } from '@nestjs/common';
import {
  StoryRepository,
  TaskRepository,
} from '../../ports/backlog-repository.port';
import { ModuleMapRepository } from '../../ports/module-map-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { assertPromotable } from '../../../domain/backlog/story-promotion';
import {
  assertTransition,
  type StoryStatus,
} from '../../../domain/backlog/story-state-machine';
import type { Actor } from '../../../domain/sessions/session-event.entity';

/** Quem promoveu, quando não é o PO. Ver `execute`. */
const ATOR_PADRAO: Actor = { kind: 'agent', id: 'po' };

/**
 * Transição de status de história validada NO DOMÍNIO. Para draft→ready aplica
 * a regra de prontidão (DoD/DoR/RF/regra) E a validação cruzada de arquitetura
 * (todos os módulos referenciados existem no module_map vigente) ANTES da
 * máquina de estados — story incompleta ou com módulo faltante não sai de
 * draft. moduleIds vazio passa (é pendência, não bloqueio).
 *
 * Fase 12c: as duas validações passaram a vir de `assertPromotable`, o mesmo
 * ponto que a CRIAÇÃO usa. Antes eram chamadas soltas aqui e `canBecomeReady`
 * lá — duas portas para o mesmo estado, com fechaduras diferentes. Como agora
 * o projeto escolhe QUEM promove (o PO na criação, ou o usuário à mão), O QUE
 * se valida não pode mais depender de por onde se entra.
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

  /**
   * `actor` existe porque a MESMA transição tem duas origens legítimas: o PO
   * promovendo na criação (modo `auto`) e o usuário promovendo à mão (modo
   * `manual`, o default desde a 12c). `backlog.story_transitioned` é imutável
   * e é o que a auditoria lê — gravar `agent/po` numa promoção que foi decisão
   * do usuário apagaria justamente o passo humano que a fase existe para
   * devolver. Opcional para o PO continuar sendo o caso sem cerimônia.
   */
  async execute(
    projectId: string,
    sessionId: string,
    storyId: string,
    to: StoryStatus,
    actor: Actor = ATOR_PADRAO,
  ) {
    const story = await this.stories.findById(storyId);
    if (!story || story.projectId !== projectId) {
      throw new NotFoundException('História não encontrada');
    }

    if (to === 'ready') {
      const current = await this.moduleMaps.findCurrent(projectId);
      assertPromotable(story, current?.modules.map((m) => m.name) ?? []);
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
        actor,
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
