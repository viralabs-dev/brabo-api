import { Injectable } from '@nestjs/common';
import {
  StoryRepository,
  TaskRepository,
} from '../../ports/backlog-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';

/**
 * Libera uma task bloqueada (Fase 4a) — decisão manual do usuário depois de
 * ler o diagnóstico. Volta a ser pegável no próximo claim.
 */
@Injectable()
export class UnblockTaskUseCase {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly stories: StoryRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly outbox: OutboxRepository,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    taskId: string,
    userId: string,
  ) {
    const task = await this.tasks.unblock(taskId);
    await this.appendEvent.execute(projectId, sessionId, {
      type: 'backlog.task_unblocked',
      actor: { kind: 'user', id: userId },
      payload: { taskId },
    });

    // Fase 12b (RN-047, ADR 0045): só emite se a story já estiver `ready` —
    // senão a task volta pegável mas ninguém pode reivindicá-la ainda, e o
    // wake seria ruído sem efeito (nenhum agente conseguiria o claim).
    const story = await this.stories.findById(task.storyId);
    if (story?.status === 'ready') {
      await this.outbox.append({
        aggregateType: 'task',
        aggregateId: task.id,
        eventType: 'task.became_claimable',
        payload: {
          projectId,
          sessionId,
          taskId: task.id,
          modules: story.moduleIds,
          cause: 'task_unblocked',
        },
      });
    }

    return task;
  }
}
