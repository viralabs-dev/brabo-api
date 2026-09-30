import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
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

  async findByProject(projectId: string): Promise<Handoff[]> {
    const db = currentDb(this.rootDb);
    const rows = await db
      .select()
      .from(handoffs)
      .where(eq(handoffs.projectId, projectId))
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

  async findOfferedToAgentInProject(
    projectId: string,
    toAgent: string,
  ): Promise<Handoff[]> {
    const db = currentDb(this.rootDb);
    const rows = await db
      .select()
      .from(handoffs)
      .where(
        and(
          eq(handoffs.projectId, projectId),
          eq(handoffs.toAgent, toAgent),
          eq(handoffs.status, 'offered'),
        ),
      )
      .orderBy(asc(handoffs.createdAt));
    return rows.map(toEntity);
  }

  async travarOfertasDoDestino(
    projectId: string,
    toAgent: string,
  ): Promise<void> {
    const db = currentDb(this.rootDb);
    // A chave é o hash de 64 bits do par — colisão só serializaria dois
    // destinos sem relação, nunca liberaria dois pedidos ao mesmo.
    await db.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`handoff:${projectId}:${toAgent}`}, 0))`,
    );
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
