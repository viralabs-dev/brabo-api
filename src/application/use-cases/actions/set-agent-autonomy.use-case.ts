import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';
import { AgentAutonomyRepository } from '../../ports/agent-autonomy-repository.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { SessionRepository } from '../../ports/session-repository.port';
import { ProposeActionUseCase } from './propose-action.use-case';
import { ApproveActionUseCase } from './approve-action.use-case';
import type { PermissionPolicy } from '../../../domain/actions/permissions-file';
import type {
  ActionType,
  AgentAutonomyActionType,
} from '../../../domain/actions/decide';

@Injectable()
export class SetAgentAutonomyUseCase {
  private readonly logger = new Logger(SetAgentAutonomyUseCase.name);

  constructor(
    private readonly projects: ProjectRepository,
    private readonly agentAutonomy: AgentAutonomyRepository,
    private readonly proposedActions: ProposedActionRepository,
    private readonly sessions: SessionRepository,
    private readonly proposeAction: ProposeActionUseCase,
    private readonly approveAction: ApproveActionUseCase,
  ) {}

  async execute(
    projectId: string,
    agentId: string,
    actionType: AgentAutonomyActionType,
    mode: PermissionPolicy,
    decidedBy: string,
  ) {
    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');
    await this.agentAutonomy.upsert(projectId, agentId, actionType, mode);
    if (actionType === '*' && mode === 'auto_approve') {
      await this.reavaliarPendentes(projectId, agentId, decidedBy);
    }
  }

  /**
   * RN-1103 (AT-908): ligar o piloto reavalia as pendentes do agente pela
   * MESMA régua da proposta. O que agora seria auto-aprovado é aprovado em
   * nome de quem ligou; os tetos (push, PR, merge) seguem pendentes.
   */
  private async reavaliarPendentes(
    projectId: string,
    agentId: string,
    decidedBy: string,
  ) {
    const project = await this.projects.findById(projectId);
    if (!project) return;
    const pendentes = (
      await this.proposedActions.findPendingByProject(projectId)
    ).filter((a) => a.actor.kind === 'agent' && a.actor.id === agentId);
    for (const a of pendentes) {
      try {
        const sessao = await this.sessions.findInProject(
          projectId,
          a.sessionId,
        );
        if (!sessao) continue;
        const decisao = await this.proposeAction.decidir(
          project,
          sessao.createdBy,
          a.actionType as ActionType,
          (a.payload ?? {}) as Record<string, unknown>,
          a.actor,
        );
        if (decisao.policy === 'auto_approve') {
          await this.approveAction.execute(
            projectId,
            a.sessionId,
            a.id,
            decidedBy,
          );
        }
      } catch (error) {
        // Uma pendente que falha não desfaz o piloto já gravado nem barra as outras.
        this.logger.error(
          `Reavaliação da ação ${a.id} falhou: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
