import { Injectable } from '@nestjs/common';
import {
  BudgetRepository,
  type BudgetInput,
} from '../../ports/budget-repository.port';
import type { BudgetScope } from '../../../domain/llm/budget.entity';

@Injectable()
export class UpsertBudgetUseCase {
  constructor(private readonly budgets: BudgetRepository) {}

  execute(scope: BudgetScope, scopeId: string, input: BudgetInput) {
    return scope === 'project'
      ? this.budgets.upsertForProject(scopeId, input)
      : this.budgets.upsertForSession(scopeId, input);
  }
}
