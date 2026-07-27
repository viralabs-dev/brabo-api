import { Injectable } from '@nestjs/common';
import { TaskRepository } from '../../ports/backlog-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';

/**
 * Libera uma task bloqueada (Fase 4a) — decisão manual do usuário depois de
 * ler o diagnóstico. Volta a ser pegável no próximo claim.
 */
@Injectable()
export class UnblockTaskUseCase {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
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
    return task;
  }
}
