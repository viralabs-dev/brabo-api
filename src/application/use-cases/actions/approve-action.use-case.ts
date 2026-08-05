import { Injectable, NotFoundException } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { SessionRepository } from '../../ports/session-repository.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { BraboMetrics } from '../../../infrastructure/observability/brabo-metrics';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { ExecuteTerminalActionUseCase } from './execute-terminal-action.use-case';
import { ExecuteAdrPrUseCase } from './execute-adr-pr.use-case';
import { ExecuteInfraPrUseCase } from './execute-infra-pr.use-case';
import { ExecuteInstructionPatchUseCase } from './execute-instruction-patch.use-case';
import { ExecuteGitActionUseCase } from './execute-git-action.use-case';
import { assertTransition } from '../../../domain/actions/action-state-machine';
import { GIT_EXECUTED_ACTION_TYPES } from '../../../domain/actions/git-action-types';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';
import { Traced } from '../../../infrastructure/observability/traced.decorator';

@Injectable()
export class ApproveActionUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly sessions: SessionRepository,
    private readonly proposedActions: ProposedActionRepository,
    private readonly outbox: OutboxRepository,
    private readonly executeTerminalAction: ExecuteTerminalActionUseCase,
    private readonly executeAdrPr: ExecuteAdrPrUseCase,
    private readonly executeInfraPr: ExecuteInfraPrUseCase,
    private readonly executeGitAction: ExecuteGitActionUseCase,
    private readonly executeInstructionPatch: ExecuteInstructionPatchUseCase,
    private readonly metrics: BraboMetrics,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
  ) {}

  @Traced('application')
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
      return this.avisarQuemEsperava(
        projectId,
        sessionId,
        await this.executeTerminalAction.execute(
          projectId,
          sessionId,
          approved,
        ),
      );
    }

    if (approved.actionType === 'open_adr_pr') {
      return this.avisarQuemEsperava(
        projectId,
        sessionId,
        await this.executeAdrPr.execute(projectId, sessionId, approved),
      );
    }

    if (approved.actionType === 'open_infra_pr') {
      return this.avisarQuemEsperava(
        projectId,
        sessionId,
        await this.executeInfraPr.execute(projectId, sessionId, approved),
      );
    }

    if (approved.actionType === 'instruction_patch') {
      return this.avisarQuemEsperava(
        projectId,
        sessionId,
        await this.executeInstructionPatch.execute(
          projectId,
          sessionId,
          approved,
        ),
      );
    }

    if (GIT_EXECUTED_ACTION_TYPES.includes(approved.actionType)) {
      return this.avisarQuemEsperava(
        projectId,
        sessionId,
        await this.executeGitAction.execute(projectId, sessionId, approved),
      );
    }

    return this.avisarQuemEsperava(projectId, sessionId, approved);
  }

  /**
   * Avisa o agente que a ação dele teve desfecho (ADR 0052).
   *
   * Um agente que propõe ação e recebe `pending` como RESULTADO da ferramenta
   * não aprendeu nada sobre o comando — e, sem poder esperar, gastava uma
   * iteração por tentativa até morrer no teto. Este evento é o que o solta,
   * com o resultado de verdade no lugar da palavra "pending".
   *
   * Vale para qualquer ator agente: quem roteia é o worker do engine, e se
   * ninguém estiver esperando por aquele id a entrega simplesmente não acha
   * destinatário. Ação auto-aprovada não passa por aqui — ela é executada na
   * proposta, e o resultado já volta no próprio tool-result.
   */
  private async avisarQuemEsperava(
    projectId: string,
    sessionId: string,
    acao: ProposedAction,
  ): Promise<ProposedAction> {
    if (acao.actor?.kind !== 'agent' || !acao.actor.id) return acao;

    await this.outbox.append({
      // `task` e não `proposed_action`: o dreno do engine só lê
      // `aggregate_type in ("session","task")`. Emitido no agregado errado, o
      // evento nascia e nunca era sequer LIDO — o agente esperava para sempre.
      aggregateType: 'task',
      aggregateId: acao.id,
      eventType: 'task.action_settled',
      payload: {
        projectId,
        sessionId,
        actionId: acao.id,
        agentId: acao.actor.id,
        actionType: acao.actionType,
        status: acao.status,
        executionResult: acao.executionResult ?? null,
      },
    });

    return acao;
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

      // A DECISÃO no event log, com quem decidiu (achado #17 do dogfooding).
      //
      // Era o buraco mais caro da colheita da Fase 10: "cliques de aprovação"
      // era a métrica principal do experimento e não existia em lugar nenhum
      // durável e consultável — a linha de outbox acima é transporte (podada
      // depois de entregue), e `proposed_actions.decided_at` diz QUANDO mas
      // não aparece na linha do tempo que o Psicólogo e a Anamnese leem.
      //
      // O ator é o usuário que clicou. É o que distingue esta linha de uma
      // auto-aprovação por política, que nasce em `proposed_action.created`
      // com `status: auto_approved` e ator AGENTE.
      await this.appendSessionEvent.execute(projectId, sessionId, {
        type: 'proposed_action.approved',
        actor: { kind: 'user', id: decidedBy },
        payload: {
          actionId,
          actionType: current.actionType,
          from: current.status,
        },
      });

      // Contador e não consulta ao banco: uma ação aprovada que executa muda
      // de status para `executed`, então `count(status='approved')` subconta
      // grosseiramente. O evento "alguém decidiu" acontece uma vez, aqui.
      this.metrics.actionsDecided.inc({
        project: projectId,
        decision: 'approved',
      });

      return updated;
    });
  }
}
