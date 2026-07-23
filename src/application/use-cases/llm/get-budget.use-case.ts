import { Injectable } from '@nestjs/common';
import { BudgetRepository } from '../../ports/budget-repository.port';
import type { BudgetScope } from '../../../domain/llm/budget.entity';

@Injectable()
export class GetBudgetUseCase {
  constructor(private readonly budgets: BudgetRepository) {}

  execute(scope: BudgetScope, scopeId: string) {
    return scope === 'project'
      ? this.budgets.findForProject(scopeId)
      : this.budgets.findForSession(scopeId);
  }
}
