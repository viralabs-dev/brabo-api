import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  RepoBootstrapRepository,
  type NewRepoBootstrap,
  type RepoBootstrapPatch,
} from '../../../application/ports/repo-bootstrap-repository.port';
import type { RepoBootstrap } from '../../../domain/git/repo-bootstrap.entity';
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
