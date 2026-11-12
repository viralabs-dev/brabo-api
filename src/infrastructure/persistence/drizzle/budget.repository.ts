import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { inicioDoMes } from '../../../domain/llm/periodo-do-teto';
import {
  BudgetRepository,
  type BudgetInput,
} from '../../../application/ports/budget-repository.port';
import type { Budget } from '../../../domain/llm/budget.entity';
import { budgets, projects } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

/** Período vencido (ADR 0296): o gasto e o limiar notificado valem 0 no mês corrente. */
function vigente<T extends Budget>(row: T | undefined): T | null {
  if (!row) return null;
  if (
    row.periodoInicio === null ||
    row.periodoInicio === inicioDoMes(new Date())
  )
    return row;
  return { ...row, spentMicros: 0, lastThresholdNotified: 0 };
}

@Injectable()
export class DrizzleBudgetRepository implements BudgetRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async findForProject(projectId: string): Promise<Budget | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(budgets)
      .where(eq(budgets.projectId, projectId));
    return vigente(row);
  }

  async findForWorkspace(workspaceId: string): Promise<Budget | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(budgets)
      .where(eq(budgets.workspaceId, workspaceId));
    return vigente(row);
  }

  async findForWorkspaceOfProject(projectId: string): Promise<Budget | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select({ b: budgets })
      .from(projects)
      .innerJoin(budgets, eq(budgets.workspaceId, projects.workspaceId))
      .where(eq(projects.id, projectId));
    return vigente(row?.b);
  }

  async findForSession(sessionId: string): Promise<Budget | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(budgets)
      .where(eq(budgets.sessionId, sessionId));
    return vigente(row);
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
        periodoInicio: inicioDoMes(new Date()),
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
    return vigente(row)!;
  }

  async upsertForWorkspace(
    workspaceId: string,
    input: BudgetInput,
  ): Promise<Budget> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .insert(budgets)
      .values({
        workspaceId,
        periodoInicio: inicioDoMes(new Date()),
        limitMicros: input.limitMicros,
        policy: input.policy,
      })
      .onConflictDoUpdate({
        target: budgets.workspaceId,
        set: {
          limitMicros: input.limitMicros,
          policy: input.policy,
          updatedAt: new Date(),
        },
      })
      .returning();
    return vigente(row)!;
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
    return vigente(row)!;
  }

  /**
   * Incrementa spent_micros atomicamente — o UPDATE em si toma o lock
   * de linha, então chamadas concorrentes pro MESMO budget serializam
   * aqui (mesmo padrão de SessionRepository.incrementSeq).
   */
  async incrementSpent(budgetId: string, deltaMicros: number): Promise<Budget> {
    const db = currentDb(this.rootDb);
    // Virada preguiçosa (ADR 0296): período vencido recomeça do delta.
    const mes = inicioDoMes(new Date());
    const vencido = sql`(${budgets.periodoInicio} is not null and ${budgets.periodoInicio} <> ${mes}::date)`;
    const [row] = await db
      .update(budgets)
      .set({
        spentMicros: sql`case when ${vencido} then ${deltaMicros} else ${budgets.spentMicros} + ${deltaMicros} end`,
        lastThresholdNotified: sql`case when ${vencido} then 0 else ${budgets.lastThresholdNotified} end`,
        periodoInicio: sql`case when ${budgets.sessionId} is not null then null else ${mes}::date end`,
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
