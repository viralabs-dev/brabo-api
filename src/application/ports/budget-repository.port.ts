import type { Budget } from '../../domain/llm/budget.entity';
import type { BudgetPolicy } from '../../domain/llm/budget-threshold';

export interface BudgetInput {
  limitMicros: number;
  policy: BudgetPolicy;
}

export abstract class BudgetRepository {
  abstract findForProject(projectId: string): Promise<Budget | null>;
  abstract findForSession(sessionId: string): Promise<Budget | null>;
  abstract findForWorkspace(workspaceId: string): Promise<Budget | null>;
  /** O teto do workspace dono do projeto (join numa consulta só). */
  abstract findForWorkspaceOfProject(projectId: string): Promise<Budget | null>;
  abstract upsertForWorkspace(
    workspaceId: string,
    input: BudgetInput,
  ): Promise<Budget>;
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
