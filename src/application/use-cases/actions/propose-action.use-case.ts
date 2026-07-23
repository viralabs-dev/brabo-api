import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { SessionRepository } from '../../ports/session-repository.port';
import { ProjectRepository } from '../../ports/project-repository.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { AgentAutonomyRepository } from '../../ports/agent-autonomy-repository.port';
import { PermissionsFileStore } from '../../ports/permissions-file-store.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { ResolveEffectiveRoleUseCase } from '../iam/resolve-effective-role.use-case';
import { ExecuteTerminalActionUseCase } from './execute-terminal-action.use-case';
import {
  decide,
  ACTION_TYPES,
  type ActionType,
} from '../../../domain/actions/decide';
import { commandFromPayload } from '../../../domain/actions/pattern-for-action';
import type { Actor } from '../../../domain/sessions/session-event.entity';
import type { ActionStatus } from '../../../domain/actions/action-state-machine';
import type { PermissionPolicy } from '../../../domain/actions/permissions-file';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';

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
    private readonly agentAutonomy: AgentAutonomyRepository,
    private readonly permissionsFileStore: PermissionsFileStore,
    private readonly outbox: OutboxRepository,
    private readonly resolveEffectiveRole: ResolveEffectiveRoleUseCase,
    private readonly executeTerminalAction: ExecuteTerminalActionUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    input: ProposeActionInput,
  ): Promise<ProposedAction> {
    const actionType = asActionType(input.actionType);

    const session = await this.sessions.findInProject(projectId, sessionId);
    if (!session) throw new NotFoundException('Sessão não encontrada');

    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');

    // Contexto todo buscado ANTES de chamar decide() — a função em si é
    // pura (ver domain/actions/decide.ts), zero IO.
    const [effectiveRole, autonomyMode, permissionsFile] = await Promise.all([
      this.resolveEffectiveRole.forProject(session.createdBy, projectId),
      input.actor.kind === 'agent'
        ? this.agentAutonomy.findMode(projectId, input.actor.id, actionType)
        : Promise.resolve(null as PermissionPolicy | null),
      this.permissionsFileStore.read(projectId),
    ]);

    const command =
      actionType === 'terminal' ? commandFromPayload(input.payload) : undefined;

    const decision = decide(
      { actionType, command },
      { effectiveRole, autonomyMode, permissionsFile },
    );

    const { status, rejectionReason } = initialStatusFor(
      decision.policy,
      decision.reason,
    );

    const action = await this.unitOfWork.runInTransaction(async () => {
      const created = await this.proposedActions.create({
        projectId,
        sessionId,
        actionType,
        payload: input.payload,
        status,
        resolvedPolicy: decision.policy,
        actor: input.actor,
        rejectionReason,
      });

      await this.outbox.append({
        aggregateType: 'proposed_action',
        aggregateId: created.id,
        eventType: 'proposed_action.created',
        payload: { actionType, status, resolvedPolicy: decision.policy },
      });

      return created;
    });

    if (status === 'auto_approved' && actionType === 'terminal') {
      return this.executeTerminalAction.execute(projectId, sessionId, action);
    }

    return action;
  }
}

function initialStatusFor(
  policy: PermissionPolicy,
  reason: string,
): { status: ActionStatus; rejectionReason: string | null } {
  switch (policy) {
    case 'auto_approve':
      return { status: 'auto_approved', rejectionReason: null };
    case 'deny':
      return { status: 'denied', rejectionReason: reason };
    case 'require_approval':
      return { status: 'pending', rejectionReason: null };
  }
}

function asActionType(value: string): ActionType {
  if ((ACTION_TYPES as string[]).includes(value)) return value as ActionType;
  throw new BadRequestException(`Tipo de ação desconhecido: "${value}"`);
}
