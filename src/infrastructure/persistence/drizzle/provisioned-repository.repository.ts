import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  ProvisionedRepositoryRepository,
  type NewProvisionedRepository,
} from '../../../application/ports/provisioned-repository-repository.port';
import type { ProvisionedRepository } from '../../../domain/git/provisioned-repository.entity';
import { projectRepositories } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleProvisionedRepositoryRepository implements ProvisionedRepositoryRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async create(
    input: NewProvisionedRepository,
  ): Promise<ProvisionedRepository> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .insert(projectRepositories)
      .values(input)
      .returning();
    return toEntity(row);
  }

  async findByProjectId(
    projectId: string,
  ): Promise<ProvisionedRepository | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(projectRepositories)
      .where(eq(projectRepositories.projectId, projectId));
    return row ? toEntity(row) : null;
  }
}

function toEntity(
  row: typeof projectRepositories.$inferSelect,
): ProvisionedRepository {
  return {
    id: row.id,
    projectId: row.projectId,
    provider: row.provider,
    externalId: row.externalId,
    url: row.url,
    defaultBranch: row.defaultBranch,
    visibility: row.visibility as 'public' | 'private',
    origin: row.origin,
    provisionedBy: row.provisionedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
