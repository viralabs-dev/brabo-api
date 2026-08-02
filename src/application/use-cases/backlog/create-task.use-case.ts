import { BadRequestException, Injectable } from '@nestjs/common';
import {
  StoryRepository,
  TaskRepository,
} from '../../ports/backlog-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';

export interface CreateTaskInput {
  storyId: string;
  title: string;
  description?: string;
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
  ) {}

  async execute(projectId: string, sessionId: string, input: CreateTaskInput) {
    const story = await this.stories.findById(input.storyId);
    if (!story || story.projectId !== projectId) {
      throw new BadRequestException(
        `História "${input.storyId}" não encontrada neste projeto`,
      );
    }

    const task = await this.tasks.create({
      storyId: input.storyId,
      title: input.title,
      description: input.description,
    });

    await this.appendEvent.execute(projectId, sessionId, {
      type: 'backlog.task_created',
      actor: { kind: 'agent', id: 'po' },
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
          modules: story.moduleIds,
          cause: 'task_created',
        },
      });
    }

    return task;
  }
}
