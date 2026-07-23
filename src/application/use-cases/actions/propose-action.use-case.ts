import { Injectable, NotFoundException } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { SessionRepository } from '../../ports/session-repository.port';
import { ProjectRepository } from '../../ports/project-repository.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { resolvePermission } from '../../../domain/actions/permission-resolver';
import type { Actor } from '../../../domain/sessions/session-event.entity';
import type { ActionStatus } from '../../../domain/actions/action-state-machine';
import type { PermissionPolicy } from '../../../domain/actions/permission-resolver';

export interface ProposeActionInput {
  actionType: string;
  actor: Actor;
  payload: Record<string, unknown>;
}

@Injectable()
export class ProposeActionUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly sessions: SessionRepository,
    private readonly projects: ProjectRepository,
    private readonly proposedActions: ProposedActionRepository,
    private readonly outbox: OutboxRepository,
  ) {}

  execute(projectId: string, sessionId: string, input: ProposeActionInput) {
    return this.unitOfWork.runInTransaction(async () => {
      const session = await this.sessions.findInProject(projectId, sessionId);
      if (!session) throw new NotFoundException('Sessão não encontrada');

      const project = await this.projects.findById(projectId);
      if (!project) throw new NotFoundException('Projeto não encontrado');

      const resolvedPolicy = resolvePermission(
        project.permissions,
        input.actionType,
      );
      const { status, rejectionReason } = initialStatusFor(
        resolvedPolicy,
        input.actionType,
      );

      const action = await this.proposedActions.create({
        projectId,
        sessionId,
        actionType: input.actionType,
        payload: input.payload,
        status,
        resolvedPolicy,
        actor: input.actor,
        rejectionReason,
      });

      await this.outbox.append({
        aggregateType: 'proposed_action',
        aggregateId: action.id,
        eventType: 'proposed_action.created',
        payload: { actionType: input.actionType, status, resolvedPolicy },
      });

      return action;
    });
  }
}

function initialStatusFor(
  policy: PermissionPolicy,
  actionType: string,
): { status: ActionStatus; rejectionReason: string | null } {
  switch (policy) {
    case 'auto_approve':
      return { status: 'auto_approved', rejectionReason: null };
    case 'deny':
      return {
        status: 'rejected',
        rejectionReason: `Ação "${actionType}" negada automaticamente pela política do projeto.`,
      };
    case 'require_approval':
      return { status: 'proposed', rejectionReason: null };
  }
}
