import { BadRequestException, Injectable } from '@nestjs/common';
import {
  StoryRepository,
  TaskRepository,
} from '../../ports/backlog-repository.port';
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

    return task;
  }
}
