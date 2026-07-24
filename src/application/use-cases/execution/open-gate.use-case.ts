import { Injectable } from '@nestjs/common';
import { TaskRepository } from '../../ports/backlog-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';

/**
 * Abre o fluxo de gates de uma PR (Fase 4a): `gate_status` vai de `null`
 * pra `'awaiting_qa'`, contador de correção zerado. Chamado pelo
 * `DevAgentServer` logo depois de `pr_open` executar com sucesso — o
 * engine dispara o `QaAgentServer` em seguida.
 */
@Injectable()
export class OpenGateUseCase {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    taskId: string,
    agentId: string,
  ) {
    const task = await this.tasks.openGate(taskId);
    await this.appendEvent.execute(projectId, sessionId, {
      type: 'pr.gate_changed',
      actor: { kind: 'agent', id: agentId },
      payload: { taskId, gateStatus: task.gateStatus },
    });
    return task;
  }
}
