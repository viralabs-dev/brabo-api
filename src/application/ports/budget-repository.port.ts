import type { Budget } from '../../domain/llm/budget.entity';
import type { BudgetPolicy } from '../../domain/llm/budget-threshold';

export interface BudgetInput {
  limitMicros: number;
  policy: BudgetPolicy;
}

export abstract class BudgetRepository {
  abstract findForProject(projectId: string): Promise<Budget | null>;
  abstract findForSession(sessionId: string): Promise<Budget | null>;
  abstract upsertForProject(
    projectId: string,
    input: BudgetInput,
  ): Promise<Budget>;
  abstract upsertForSession(
    sessionId: string,
    input: BudgetInput,
  ): Promise<Budget>;

  /** Incrementa spent_micros atomicamente (lock de linha via UPDATE, sem retry loop). */
  abstract incrementSpent(
    budgetId: string,
    deltaMicros: number,
  ): Promise<Budget>;
  abstract updateLastNotified(
    budgetId: string,
    threshold: number,
  ): Promise<void>;
}
