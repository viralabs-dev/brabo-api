import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  ContainerRepository,
  type CreateContainerLifecycleInput,
  type UpdateContainerLifecycleInput,
} from '../../../application/ports/container-repository.port';
import type {
  ContainerLifecycleStatus,
  ProjectContainerLifecycle,
} from '../../../domain/containers/container-lifecycle';
import { projectContainers } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

type Row = typeof projectContainers.$inferSelect;

function toDomain(row: Row): ProjectContainerLifecycle {
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status,
    imageVersion: row.imageVersion,
    containerId: row.containerId,
    resources: {
      cpus: row.cpus,
      memoryMb: row.memoryMb,
      pidsLimit: row.pidsLimit,
    },
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    statusChangedAt: row.statusChangedAt,
  };
}

@Injectable()
export class DrizzleContainerRepository implements ContainerRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async findByProject(
    projectId: string,
  ): Promise<ProjectContainerLifecycle | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(projectContainers)
      .where(eq(projectContainers.projectId, projectId));
    return row ? toDomain(row) : null;
  }

  async findByProjectForUpdate(
    projectId: string,
  ): Promise<ProjectContainerLifecycle | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(projectContainers)
      .where(eq(projectContainers.projectId, projectId))
      .for('update');
    return row ? toDomain(row) : null;
  }

  async create(
    input: CreateContainerLifecycleInput,
  ): Promise<ProjectContainerLifecycle> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .insert(projectContainers)
      .values({
        projectId: input.projectId,
        status: 'provisioning',
        imageVersion: input.imageVersion,
        cpus: input.resources.cpus,
        memoryMb: input.resources.memoryMb,
        pidsLimit: input.resources.pidsLimit,
      })
      .returning();
    return toDomain(row);
  }

  async updateStatus(
    id: string,
    status: ContainerLifecycleStatus,
    patch: UpdateContainerLifecycleInput = {},
  ): Promise<ProjectContainerLifecycle> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(projectContainers)
      .set({
        status,
        statusChangedAt: new Date(),
        // `undefined` não entra no `set` (drizzle omite a chave) — só grava
        // quando o chamador passou o campo explicitamente.
        ...(patch.containerId !== undefined
          ? { containerId: patch.containerId }
          : {}),
        ...(patch.failureReason !== undefined
          ? { failureReason: patch.failureReason }
          : {}),
      })
      .where(eq(projectContainers.id, id))
      .returning();
    return toDomain(row);
  }
}
