import { Injectable, NotFoundException } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { SessionRepository } from '../../ports/session-repository.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { ExecuteTerminalActionUseCase } from './execute-terminal-action.use-case';
import { assertTransition } from '../../../domain/actions/action-state-machine';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';

@Injectable()
export class ApproveActionUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly sessions: SessionRepository,
    private readonly proposedActions: ProposedActionRepository,
    private readonly outbox: OutboxRepository,
    private readonly executeTerminalAction: ExecuteTerminalActionUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    actionId: string,
    decidedBy: string,
  ): Promise<ProposedAction> {
    const approved = await this.approve(
      projectId,
      sessionId,
      actionId,
      decidedBy,
    );

    if (approved.actionType === 'terminal') {
      return this.executeTerminalAction.execute(projectId, sessionId, approved);
    }

    return approved;
  }

  private approve(
    projectId: string,
    sessionId: string,
    actionId: string,
    decidedBy: string,
  ) {
    return this.unitOfWork.runInTransaction(async () => {
      const session = await this.sessions.findInProject(projectId, sessionId);
      if (!session) throw new NotFoundException('Sessão não encontrada');

      const current = await this.proposedActions.findInSessionForUpdate(
        sessionId,
        actionId,
      );
      if (!current) throw new NotFoundException('Ação não encontrada');

      assertTransition(current.status, 'approved');

      const updated = await this.proposedActions.updateDecision(actionId, {
        status: 'approved',
        decidedBy,
        decidedAt: new Date(),
        rejectionReason: null,
      });

      await this.outbox.append({
        aggregateType: 'proposed_action',
        aggregateId: actionId,
        eventType: 'proposed_action.approved',
        payload: { from: current.status, to: 'approved' },
      });

      return updated;
    });
  }
}
