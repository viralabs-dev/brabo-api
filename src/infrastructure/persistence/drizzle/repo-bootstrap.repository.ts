import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  RepoBootstrapRepository,
  type NewRepoBootstrap,
  type RepoBootstrapPatch,
} from '../../../application/ports/repo-bootstrap-repository.port';
import type {
  BootstrapPlan,
  BootstrapPlanDecision,
  RepoBootstrap,
} from '../../../domain/git/repo-bootstrap.entity';
import { repoBootstraps } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleRepoBootstrapRepository implements RepoBootstrapRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async create(input: NewRepoBootstrap): Promise<RepoBootstrap> {
    const db = currentDb(this.rootDb);
    const [row] = await db.insert(repoBootstraps).values(input).returning();
    return toEntity(row);
  }

  async findByProjectId(projectId: string): Promise<RepoBootstrap | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(repoBootstraps)
      .where(eq(repoBootstraps.projectId, projectId));
    return row ? toEntity(row) : null;
  }

  async update(
    projectId: string,
    patch: RepoBootstrapPatch,
  ): Promise<RepoBootstrap> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(repoBootstraps)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(repoBootstraps.projectId, projectId))
      .returning();
    return toEntity(row);
  }

  async savePlan(
    projectId: string,
    plan: BootstrapPlan,
  ): Promise<RepoBootstrap> {
    const db = currentDb(this.rootDb);
    // `planDecision` NÃO entra no set: readotar regenera o plano, e uma
    // decisão que já existia sobrevive à regeneração (Fase 12a).
    //
    // `planGeneratedAt` vem do PRÓPRIO plano, não de um `new Date()` daqui.
    // Eram dois relógios: `planBootstrap()` carimba `generatedAt` quando monta
    // o plano, e esta linha carimbava outro instante alguns milissegundos
    // depois. A guarda otimista de `DecideBootstrapPlanUseCase` compara os
    // dois — então ela só aprovava quando as duas chamadas caíam no mesmo
    // milissegundo, e recusava com "o plano foi regerado" em qualquer decisão
    // sobre um plano que ninguém tinha regerado. Funcionava por acidente de
    // relógio; qualquer escrita a mais no caminho fazia a decisão falhar.
    const [row] = await db
      .update(repoBootstraps)
      .set({
        plan,
        planGeneratedAt: new Date(plan.generatedAt),
        updatedAt: new Date(),
      })
      .where(eq(repoBootstraps.projectId, projectId))
      .returning();
    return toEntity(row);
  }

  async recordPlanDecision(
    projectId: string,
    decision: BootstrapPlanDecision,
    decidedBy: string,
  ): Promise<RepoBootstrap> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(repoBootstraps)
      .set({
        planDecision: decision,
        planDecidedAt: new Date(),
        planDecidedBy: decidedBy,
        updatedAt: new Date(),
      })
      .where(eq(repoBootstraps.projectId, projectId))
      .returning();
    return toEntity(row);
  }
}

function toEntity(row: typeof repoBootstraps.$inferSelect): RepoBootstrap {
  return {
    id: row.id,
    projectId: row.projectId,
    sessionId: row.sessionId,
    step: row.step,
    status: row.status,
    attempts: row.attempts,
    lastError: row.lastError,
    origin: row.origin,
    plan: (row.plan as BootstrapPlan | null) ?? null,
    planGeneratedAt: row.planGeneratedAt,
    planDecision: row.planDecision,
    planDecidedAt: row.planDecidedAt,
    planDecidedBy: row.planDecidedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
