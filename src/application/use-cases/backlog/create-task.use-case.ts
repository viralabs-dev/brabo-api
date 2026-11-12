import { BadRequestException, Injectable } from '@nestjs/common';
import {
  StoryRepository,
  TaskRepository,
} from '../../ports/backlog-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';

export interface CreateTaskInput {
  storyId: string;
  title: string;
  description?: string;
  /**
   * AT-912 (RN-1006): o módulo da tarefa, que precisa estar nos `moduleIds` da
   * história. Omitido, a tarefa herda o módulo da história quando ela tem UM
   * só; com vários, nasce sem módulo e espera o plano.
   */
  module?: string;
  /** Quem cria (po | dev_lead); o padrão é po. */
  actorId?: string;
}

/**
 * Cria uma tarefa sob uma história (via ferramenta create_task do PO). A
 * tarefa herda o vínculo a regra da story (derivado). Valida que a story
 * existe no projeto.
 */
@Injectable()
export class CreateTaskUseCase {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly stories: StoryRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly outbox: OutboxRepository,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(projectId: string, sessionId: string, input: CreateTaskInput) {
    const story = await this.stories.findById(input.storyId);
    if (!story || story.projectId !== projectId) {
      throw new BadRequestException(
        `História "${input.storyId}" não encontrada neste projeto`,
      );
    }
    // RN-727: história arquivada saiu do jogo — tarefa nova nela não seria
    // pegável por ninguém.
    if (story.archivedAt) {
      throw new BadRequestException(
        `A história "${story.title}" está arquivada — não recebe tarefa nova`,
      );
    }

    const pedido = input.module?.trim() || null;
    if (pedido && !story.moduleIds.includes(pedido)) {
      throw new BadRequestException(
        `O módulo "${pedido}" não é da história "${story.title}" (módulos dela: ${story.moduleIds.join(', ') || 'nenhum'}).`,
      );
    }
    const module =
      pedido ?? (story.moduleIds.length === 1 ? story.moduleIds[0] : null);

    // Criação e wake na MESMA transação (D7): commitar a task sem a linha de
    // outbox deixaria uma task pegável que ninguém foi avisado que existe.
    return this.unitOfWork.runInTransaction(async () => {
      const task = await this.tasks.create({
        storyId: input.storyId,
        title: input.title,
        description: input.description,
        module,
      });

      await this.appendEvent.execute(projectId, sessionId, {
        type: 'backlog.task_created',
        actor: { kind: 'agent', id: input.actorId ?? 'po' },
        payload: { taskId: task.id, storyId: task.storyId, title: task.title },
      });

      // Fase 12b (RN-047, ADR 0045): a story já pode estar `ready` (segunda
      // task pra frente, ou task criada tarde numa story já promovida) — sem
      // isto, a task nasceria pegável e nenhum dev agent idle acordaria pra
      // ela até o próximo gate resolver em outro lugar.
      if (story.status === 'ready') {
        await this.outbox.append({
          aggregateType: 'task',
          aggregateId: task.id,
          eventType: 'task.became_claimable',
          payload: {
            projectId,
            sessionId,
            taskId: task.id,
            modules: module ? [module] : story.moduleIds,
            cause: 'task_created',
          },
        });
      }

      return task;
    });
  }
}
