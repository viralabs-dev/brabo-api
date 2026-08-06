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
import { ExecuteGitActionUseCase } from './execute-git-action.use-case';
import { ExecuteInfraPrUseCase } from './execute-infra-pr.use-case';
import {
  decide,
  ACTION_TYPES,
  type ActionType,
} from '../../../domain/actions/decide';
import { GIT_EXECUTED_ACTION_TYPES } from '../../../domain/actions/git-action-types';
import {
  commandFromPayload,
  cwdFromPayload,
} from '../../../domain/actions/pattern-for-action';
import { projectScopeRoot } from '../../../infrastructure/filesystem/project-workspaces-root';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import type { Actor } from '../../../domain/sessions/session-event.entity';
import type { ActionStatus } from '../../../domain/actions/action-state-machine';
import type { PermissionPolicy } from '../../../domain/actions/permissions-file';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';
import { Traced } from '../../../infrastructure/observability/traced.decorator';

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
    private readonly executeGitAction: ExecuteGitActionUseCase,
    private readonly executeInfraPr: ExecuteInfraPrUseCase,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
  ) {}

  @Traced('application')
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
    const rawTargetBranch = (input.payload as { targetBranch?: unknown })
      .targetBranch;
    const targetBranch =
      actionType === 'git_merge' && typeof rawTargetBranch === 'string'
        ? rawTargetBranch
        : undefined;

    const decision = decide(
      {
        actionType,
        command,
        targetBranch,
        cwd:
          actionType === 'terminal' ? cwdFromPayload(input.payload) : undefined,
      },
      {
        effectiveRole,
        autonomyMode,
        permissionsFile,
        projectScopeRoot: projectScopeRoot(projectId),
      },
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

      // O MESMO fato no event log (achado #17 do dogfooding). A linha de
      // outbox acima existe desde a Fase 1 e é consumida pelo engine — ela é
      // transporte, não memória: o outbox é podado, e `processed_at` conta
      // entrega, não decisão. `docs/reference/events.md` documentava
      // `proposed_action.created` como evento de domínio desde sempre; até
      // aqui isso simplesmente não era verdade.
      //
      // `status` no payload é o que torna a auto-aprovação AUDITÁVEL: sem ele
      // não há como distinguir "o usuário clicou" de "a política decidiu
      // sozinha", que é exatamente a métrica que a Fase 10 quis medir e não
      // conseguiu.
      await this.appendSessionEvent.execute(projectId, sessionId, {
        type: 'proposed_action.created',
        actor: input.actor,
        payload: {
          actionId: created.id,
          actionType,
          status,
          resolvedPolicy: decision.policy,
        },
      });

      return created;
    });

    if (status === 'auto_approved' && actionType === 'terminal') {
      return this.executeTerminalAction.execute(projectId, sessionId, action);
    }

    if (
      status === 'auto_approved' &&
      GIT_EXECUTED_ACTION_TYPES.includes(actionType)
    ) {
      return this.executeGitAction.execute(projectId, sessionId, action);
    }

    if (status === 'auto_approved' && actionType === 'open_infra_pr') {
      return this.executeInfraPr.execute(projectId, sessionId, action);
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
