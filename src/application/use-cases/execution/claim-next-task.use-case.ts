import { Injectable } from '@nestjs/common';
import { TaskRepository } from '../../ports/backlog-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';

/**
 * Um dev "pega" a próxima task pegável do seu módulo (task `todo` de story
 * `ready`), atômico (FOR UPDATE SKIP LOCKED — dois devs nunca pegam a mesma).
 * Chamado pelo DevAgentServer via endpoint interno. Emite `backlog.task_claimed`
 * quando pega algo.
 */
@Injectable()
export class ClaimNextTaskUseCase {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    module: string,
    agentId: string,
  ) {
    const task = await this.tasks.claimNext(projectId, module, agentId);
    if (task) {
      await this.appendEvent.execute(projectId, sessionId, {
        type: 'backlog.task_claimed',
        actor: { kind: 'agent', id: agentId },
        payload: { taskId: task.id, title: task.title, module },
      });
    }
    return task;
  }
}
