import { Injectable } from '@nestjs/common';
import { BudgetRepository } from '../../ports/budget-repository.port';
import { isBlocked } from '../../../domain/llm/budget-threshold';

export interface BudgetGateResult {
  blocked: boolean;
  reason?: string;
}

/**
 * Checagem PRÉ-chamada, fail-closed: se não der pra confirmar o estado
 * do budget (erro no repositório), a chamada é recusada — nunca
 * liberada por omissão. Projeto e sessão são verificados
 * independentemente; qualquer um dos dois bloqueado já recusa.
 */
@Injectable()
export class CheckBudgetGateUseCase {
  constructor(private readonly budgets: BudgetRepository) {}

  async execute(
    projectId: string,
    sessionId: string,
  ): Promise<BudgetGateResult> {
    try {
      const [projectBudget, sessionBudget] = await Promise.all([
        this.budgets.findForProject(projectId),
        this.budgets.findForSession(sessionId),
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

      return { blocked: false };
    } catch {
      return { blocked: true, reason: 'Não foi possível verificar o budget' };
    }
  }
}
