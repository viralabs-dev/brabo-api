import { Injectable } from '@nestjs/common';
import { TaskRepository } from '../../ports/backlog-repository.port';
import { ModuleMapRepository } from '../../ports/module-map-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import type { TaskStatus } from '../../../domain/backlog/backlog.entity';

/**
 * Atualiza o status de uma task (o dev "atualiza o backlog" ao longo do ciclo).
 *
 * RN-1081 (AT-906): `done` também acorda os dev agents dos módulos com
 * `dependsOn`, como o merge da PR (RN-1009) — a tarefa que fecha por "já na
 * main" (RN-797) passa por aqui, e sem o wake o dependente ficava ocioso.
 */
@Injectable()
export class MarkTaskUseCase {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly moduleMaps: ModuleMapRepository,
    private readonly outbox: OutboxRepository,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    taskId: string,
    status: TaskStatus,
    agentId: string,
  ) {
    return this.unitOfWork.runInTransaction(async () => {
      const task = await this.tasks.updateStatus(taskId, status);
      await this.appendEvent.execute(projectId, sessionId, {
        type: 'backlog.task_status_changed',
        actor: { kind: 'agent', id: agentId },
        payload: { taskId, status },
      });
      if (status === 'done') {
        // Mesma regra do `acordarDependentes` do merge: mais largo que "só os
        // dependentes", porque o wake extra custa um claim vazio.
        const mapa = await this.moduleMaps.findCurrent(projectId);
        const modules = (mapa?.modules ?? [])
          .filter((m) => m.dependsOn.length > 0)
          .map((m) => m.name);
        if (modules.length > 0) {
          await this.outbox.append({
            aggregateType: 'task',
            aggregateId: taskId,
            eventType: 'task.became_claimable',
            payload: {
              projectId,
              sessionId,
              taskId,
              modules,
              cause: 'dependency_done',
            },
          });
        }
      }
      return task;
    });
  }
}
