import { Injectable } from '@nestjs/common';
import { TaskRepository } from '../../ports/backlog-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';

/**
 * O DevAgent não conseguiu concluir a task (Fase 4a) — devolve pra `todo`
 * com diagnóstico, sem dono. Fica EXCLUÍDA do próximo claim automático
 * (`ClaimNextTaskUseCase`/`claimNext`) até um humano ler o diagnóstico e
 * liberar via `UnblockTaskUseCase` — nunca reclaim silencioso em loop.
 */
@Injectable()
export class MarkTaskBlockedUseCase {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    taskId: string,
    reason: string,
    diagnosis: string,
    agentId: string,
  ) {
    const task = await this.tasks.markBlocked(taskId, reason, diagnosis);
    await this.appendEvent.execute(projectId, sessionId, {
      type: 'backlog.task_blocked',
      actor: { kind: 'agent', id: agentId },
      payload: { taskId, reason, diagnosis },
    });
    return task;
  }
}
