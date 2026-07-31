import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import {
  DelegationRepository,
  type NewDelegation,
} from '../../../application/ports/delegation-repository.port';
import type { Delegation } from '../../../domain/agents/delegation.entity';
import { delegations } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleDelegationRepository implements DelegationRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async create(input: NewDelegation): Promise<Delegation> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .insert(delegations)
      .values({
        projectId: input.projectId,
        sessionId: input.sessionId,
        taskId: input.taskId ?? null,
        area: input.area,
        leadAgent: input.leadAgent,
        subagent: input.subagent,
        status: input.status,
        parecerArtifactId: input.parecerArtifactId ?? null,
        failureOrigin: input.failureOrigin ?? null,
        failureReason: input.failureReason ?? null,
        justification: input.justification ?? null,
      })
      .returning();
    return toEntity(row);
  }

  async findByTask(taskId: string): Promise<Delegation[]> {
    const db = currentDb(this.rootDb);
    const rows = await db
      .select()
      .from(delegations)
      .where(eq(delegations.taskId, taskId))
      .orderBy(asc(delegations.createdAt));
    return rows.map(toEntity);
  }
}

function toEntity(row: typeof delegations.$inferSelect): Delegation {
  return {
    id: row.id,
    projectId: row.projectId,
    sessionId: row.sessionId,
    taskId: row.taskId,
    area: row.area,
    leadAgent: row.leadAgent,
    subagent: row.subagent,
    status: row.status,
    parecerArtifactId: row.parecerArtifactId,
    failureOrigin: row.failureOrigin,
    failureReason: row.failureReason,
    justification: row.justification,
    createdAt: row.createdAt,
  };
}
