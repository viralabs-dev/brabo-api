import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import {
  BudgetRepository,
  type BudgetInput,
} from '../../../application/ports/budget-repository.port';
import type { Budget } from '../../../domain/llm/budget.entity';
import { budgets } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleBudgetRepository implements BudgetRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async findForProject(projectId: string): Promise<Budget | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(budgets)
      .where(eq(budgets.projectId, projectId));
    return row ?? null;
  }

  async findForSession(sessionId: string): Promise<Budget | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(budgets)
      .where(eq(budgets.sessionId, sessionId));
    return row ?? null;
  }

  async upsertForProject(
    projectId: string,
    input: BudgetInput,
  ): Promise<Budget> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .insert(budgets)
      .values({
        projectId,
        limitMicros: input.limitMicros,
        policy: input.policy,
      })
      .onConflictDoUpdate({
        target: budgets.projectId,
        set: {
          limitMicros: input.limitMicros,
          policy: input.policy,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async upsertForSession(
    sessionId: string,
    input: BudgetInput,
  ): Promise<Budget> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .insert(budgets)
      .values({
        sessionId,
        limitMicros: input.limitMicros,
        policy: input.policy,
      })
      .onConflictDoUpdate({
        target: budgets.sessionId,
        set: {
          limitMicros: input.limitMicros,
          policy: input.policy,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  /**
   * Incrementa spent_micros atomicamente — o UPDATE em si toma o lock
   * de linha, então chamadas concorrentes pro MESMO budget serializam
   * aqui (mesmo padrão de SessionRepository.incrementSeq).
   */
  async incrementSpent(budgetId: string, deltaMicros: number): Promise<Budget> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(budgets)
      .set({
        spentMicros: sql`${budgets.spentMicros} + ${deltaMicros}`,
        updatedAt: new Date(),
      })
      .where(eq(budgets.id, budgetId))
      .returning();
    if (!row) throw new NotFoundException('Budget não encontrado');
    return row;
  }

  async updateLastNotified(budgetId: string, threshold: number): Promise<void> {
    const db = currentDb(this.rootDb);
    await db
      .update(budgets)
      .set({ lastThresholdNotified: threshold, updatedAt: new Date() })
      .where(eq(budgets.id, budgetId));
  }
}
