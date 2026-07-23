import { Injectable, NotFoundException } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { SessionRepository } from '../../ports/session-repository.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { assertTransition } from '../../../domain/actions/action-state-machine';

@Injectable()
export class DenyActionUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly sessions: SessionRepository,
    private readonly proposedActions: ProposedActionRepository,
    private readonly outbox: OutboxRepository,
  ) {}

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

      return updated;
    });
  }
}
