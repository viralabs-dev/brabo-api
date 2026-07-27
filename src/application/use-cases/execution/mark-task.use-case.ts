import { Injectable } from '@nestjs/common';
import { TaskRepository } from '../../ports/backlog-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import type { TaskStatus } from '../../../domain/backlog/backlog.entity';

/**
 * Atualiza o status de uma task (o dev "atualiza o backlog" ao longo do ciclo).
 */
@Injectable()
export class MarkTaskUseCase {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    taskId: string,
    status: TaskStatus,
    agentId: string,
  ) {
    const task = await this.tasks.updateStatus(taskId, status);
    await this.appendEvent.execute(projectId, sessionId, {
      type: 'backlog.task_status_changed',
      actor: { kind: 'agent', id: agentId },
      payload: { taskId, status },
    });
    return task;
  }
}
