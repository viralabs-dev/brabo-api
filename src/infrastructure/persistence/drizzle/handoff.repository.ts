import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import {
  HandoffRepository,
  type NewHandoff,
} from '../../../application/ports/handoff-repository.port';
import type {
  Handoff,
  HandoffStatus,
} from '../../../domain/sessions/handoff.entity';
import { handoffs } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleHandoffRepository implements HandoffRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async create(input: NewHandoff): Promise<Handoff> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .insert(handoffs)
      .values({
        sessionId: input.sessionId,
        projectId: input.projectId,
        fromAgent: input.fromAgent,
        toAgent: input.toAgent,
        artifactId: input.artifactId ?? null,
        status: input.status ?? 'offered',
      })
      .returning();
    return toEntity(row);
  }

  async findById(id: string): Promise<Handoff | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(handoffs)
      .where(eq(handoffs.id, id))
      .limit(1);
    return row ? toEntity(row) : null;
  }

  async findBySession(sessionId: string): Promise<Handoff[]> {
    const db = currentDb(this.rootDb);
    const rows = await db
      .select()
      .from(handoffs)
      .where(eq(handoffs.sessionId, sessionId))
      .orderBy(asc(handoffs.createdAt));
    return rows.map(toEntity);
  }

  async updateStatus(id: string, status: HandoffStatus): Promise<Handoff> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(handoffs)
      .set({ status, updatedAt: new Date() })
      .where(eq(handoffs.id, id))
      .returning();
    return toEntity(row);
  }
}

function toEntity(row: typeof handoffs.$inferSelect): Handoff {
  return {
    id: row.id,
    sessionId: row.sessionId,
    projectId: row.projectId,
    fromAgent: row.fromAgent,
    toAgent: row.toAgent,
    artifactId: row.artifactId,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
