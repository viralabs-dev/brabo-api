import { Injectable } from '@nestjs/common';
import { BudgetRepository } from '../../ports/budget-repository.port';
import { AgentAreaRepository } from '../../ports/agent-area-repository.port';
import { isBlocked } from '../../../domain/llm/budget-threshold';
import { isAreaBudgetExceeded } from '../../../domain/llm/area-budget';
import { areaDo } from '../../../domain/agents/agent-areas';

export interface BudgetGateResult {
  blocked: boolean;
  reason?: string;
}

/**
 * Checagem PRÉ-chamada, fail-closed: se não der pra confirmar o estado
 * do budget (erro no repositório), a chamada é recusada — nunca
 * liberada por omissão. Projeto, sessão e ÁREA (ADR 0110) são verificados
 * INDEPENDENTEMENTE; qualquer um dos três bloqueado já recusa. Aditivo, não
 * cascata — não é "o mais específico vence" (isso é o binding de modelo do
 * ADR 0064, mecanismo diferente).
 */
@Injectable()
export class CheckBudgetGateUseCase {
  constructor(
    private readonly budgets: BudgetRepository,
    private readonly areas: AgentAreaRepository,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    agentId?: string,
  ): Promise<BudgetGateResult> {
    try {
      // `areaDo` é função pura (RN-094/ADR 0053): dá pra saber a CHAVE da
      // área sem bater no banco. Só quando o agente pertence a alguma área é
      // que vale a pena buscar a linha (que traz o teto de verdade).
      const area = agentId ? areaDo(agentId) : undefined;

      const [projectBudget, sessionBudget, areaRow] = await Promise.all([
        this.budgets.findForProject(projectId),
        this.budgets.findForSession(sessionId),
        area ? this.areas.findByKey(projectId, area.key) : null,
      ]);

      if (
        projectBudget &&
        isBlocked(
          projectBudget.spentMicros,
          projectBudget.limitMicros,
          projectBudget.policy,
        )
      ) {
        return { blocked: true, reason: 'Budget do projeto atingiu o limite' };
      }

      if (
        sessionBudget &&
        isBlocked(
          sessionBudget.spentMicros,
          sessionBudget.limitMicros,
          sessionBudget.policy,
        )
      ) {
        return { blocked: true, reason: 'Budget da sessão atingiu o limite' };
      }

      if (
        areaRow &&
        isAreaBudgetExceeded(areaRow.spentMicros, areaRow.budgetMicros)
      ) {
        return {
          blocked: true,
          reason: `Budget da área "${areaRow.key}" atingiu o limite`,
        };
      }

      return { blocked: false };
    } catch {
      return { blocked: true, reason: 'Não foi possível verificar o budget' };
    }
  }
}
