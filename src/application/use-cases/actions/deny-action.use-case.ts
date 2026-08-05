import { Injectable, NotFoundException } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { SessionRepository } from '../../ports/session-repository.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { BraboMetrics } from '../../../infrastructure/observability/brabo-metrics';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { assertTransition } from '../../../domain/actions/action-state-machine';
import { Traced } from '../../../infrastructure/observability/traced.decorator';

@Injectable()
export class DenyActionUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly sessions: SessionRepository,
    private readonly proposedActions: ProposedActionRepository,
    private readonly outbox: OutboxRepository,
    private readonly metrics: BraboMetrics,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
  ) {}

  @Traced('application')
  execute(
    projectId: string,
    sessionId: string,
    actionId: string,
    decidedBy: string,
    reason?: string,
  ) {
    return this.unitOfWork.runInTransaction(async () => {
      const session = await this.sessions.findInProject(projectId, sessionId);
      if (!session) throw new NotFoundException('Sessão não encontrada');

      const current = await this.proposedActions.findInSessionForUpdate(
        sessionId,
        actionId,
      );
      if (!current) throw new NotFoundException('Ação não encontrada');

      assertTransition(current.status, 'denied');

      const updated = await this.proposedActions.updateDecision(actionId, {
        status: 'denied',
        decidedBy,
        decidedAt: new Date(),
        rejectionReason: reason ?? null,
      });

      await this.outbox.append({
        aggregateType: 'proposed_action',
        aggregateId: actionId,
        eventType: 'proposed_action.denied',
        payload: { from: current.status, to: 'denied' },
      });

      // A recusa no event log, com quem recusou e por quê (achado #17). Estado
      // TERMINAL: nada mais acontece com esta ação, e sem este evento a única
      // pista de que alguém disse "não" era uma coluna de tabela.
      await this.appendSessionEvent.execute(projectId, sessionId, {
        type: 'proposed_action.denied',
        actor: { kind: 'user', id: decidedBy },
        payload: {
          actionId,
          actionType: current.actionType,
          from: current.status,
          reason: reason ?? null,
        },
      });

      // Negar o `pr_open` de um dev agent é DESFECHO (Fase 12e): sem esta
      // linha o agente ficaria em `awaiting_approval` esperando um gate que
      // ninguém vai abrir. `opened: false` faz ele bloquear a task com
      // diagnóstico em vez de travar — a mesma doutrina de "nunca reclaim
      // silencioso" do ADR 0020.
      const taskId = (updated.payload as { storyTaskId?: unknown }).storyTaskId;
      if (
        updated.actionType === 'pr_open' &&
        typeof taskId === 'string' &&
        updated.actor?.id
      ) {
        await this.outbox.append({
          aggregateType: 'task',
          aggregateId: taskId,
          eventType: 'task.pr_settled',
          payload: {
            projectId,
            sessionId,
            taskId,
            agentId: updated.actor.id,
            opened: false,
          },
        });
      }

      // Recusa também é RESPOSTA (ADR 0052). O agente que esperava a decisão
      // retoma o laço com o motivo no lugar do resultado, e aprende que aquele
      // caminho está fechado — em vez de esperar para sempre por algo que
      // ninguém vai aprovar.
      //
      // O `pr_open` acima é o caso especial que a Fase 12e já tratava: lá o
      // desfecho é a task inteira, aqui é uma ferramenta no meio do turno.
      if (updated.actor?.kind === 'agent' && updated.actor.id) {
        await this.outbox.append({
          aggregateType: 'proposed_action',
          aggregateId: actionId,
          eventType: 'task.action_settled',
          payload: {
            projectId,
            sessionId,
            actionId,
            agentId: updated.actor.id,
            actionType: updated.actionType,
            status: 'denied',
            rejectionReason: reason ?? null,
          },
        });
      }

      this.metrics.actionsDecided.inc({
        project: projectId,
        decision: 'denied',
      });

      return updated;
    });
  }
}
