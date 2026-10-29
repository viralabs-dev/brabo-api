import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  QaEnvironmentRepository,
  type InstanciaDeQa,
} from '../../../application/ports/qa-environment-repository.port';
import type { StatusDeInstanciaDeQa } from '../../../domain/containers/instancia-de-qa';
import { projectQaEnvironments, tasks, stories } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

type Row = typeof projectQaEnvironments.$inferSelect;
const toDomain = (r: Row): InstanciaDeQa => ({
  id: r.id,
  projectId: r.projectId,
  taskId: r.taskId,
  status: r.status,
});

@Injectable()
export class DrizzleQaEnvironmentRepository implements QaEnvironmentRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async resolverTarefas(
    projectId: string,
    ref: { id: string } | { chave: string },
  ): Promise<string[]> {
    const db = currentDb(this.rootDb);
    const casa =
      'id' in ref
        ? eq(tasks.id, ref.id)
        : sql`replace(${tasks.id}::text, '-', '') like ${ref.chave + '%'}`;
    const rows = await db
      .select({ id: tasks.id })
      .from(tasks)
      .innerJoin(stories, eq(stories.id, tasks.storyId))
      .where(and(eq(stories.projectId, projectId), casa))
      .limit(2);
    return rows.map((r) => r.id);
  }

  async find(projectId: string, taskId: string) {
    const db = currentDb(this.rootDb);
    const [r] = await db
      .select()
      .from(projectQaEnvironments)
      .where(
        and(
          eq(projectQaEnvironments.projectId, projectId),
          eq(projectQaEnvironments.taskId, taskId),
        ),
      );
    return r ? toDomain(r) : null;
  }

  async findAtivaDoProjeto(projectId: string) {
    const db = currentDb(this.rootDb);
    const [r] = await db
      .select()
      .from(projectQaEnvironments)
      .where(
        and(
          eq(projectQaEnvironments.projectId, projectId),
          inArray(projectQaEnvironments.status, ['provisioning', 'running']),
        ),
      );
    return r ? toDomain(r) : null;
  }

  async listarParaLimpeza(projectId?: string) {
    const db = currentDb(this.rootDb);
    const rows = await db
      .select()
      .from(projectQaEnvironments)
      .where(
        and(
          inArray(projectQaEnvironments.status, [
            'provisioning',
            'running',
            'failed',
          ]),
          projectId
            ? eq(projectQaEnvironments.projectId, projectId)
            : undefined,
        ),
      );
    return rows.map(toDomain);
  }

  async criar(projectId: string, taskId: string) {
    const db = currentDb(this.rootDb);
    const [r] = await db
      .insert(projectQaEnvironments)
      .values({ projectId, taskId })
      .returning();
    return toDomain(r);
  }

  async atualizarStatus(id: string, status: StatusDeInstanciaDeQa) {
    const db = currentDb(this.rootDb);
    const [r] = await db
      .update(projectQaEnvironments)
      .set({ status, updatedAt: new Date() })
      .where(eq(projectQaEnvironments.id, id))
      .returning();
    return toDomain(r);
  }
}
