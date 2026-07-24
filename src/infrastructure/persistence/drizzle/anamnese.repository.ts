import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  AnamneseQueueRepository,
  AnamneseRunRepository,
  type AnamneseQueueEntry,
  type AnamneseRun,
  type NewAnamneseRun,
} from '../../../application/ports/anamnese-repository.port';
import { anamneseQueue, anamneseRuns } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleAnamneseQueueRepository implements AnamneseQueueRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async enqueueHypothesis(
    projectId: string,
    hypothesisId: string,
  ): Promise<void> {
    const db = currentDb(this.rootDb);
    // unique(hypothesis_id) + doNothing = aceitar a mesma hipótese duas
    // vezes nunca enfileira duas.
    await db
      .insert(anamneseQueue)
      .values({ projectId, hypothesisId, origin: 'hypothesis' })
      .onConflictDoNothing();
  }

  async listPending(projectId: string): Promise<AnamneseQueueEntry[]> {
    const db = currentDb(this.rootDb);
    const rows = await db
      .select()
      .from(anamneseQueue)
      .where(
        and(
          eq(anamneseQueue.projectId, projectId),
          eq(anamneseQueue.status, 'pending'),
        ),
      );
    return rows.map(toQueueEntry);
  }

  async markConsumed(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = currentDb(this.rootDb);
    await db
      .update(anamneseQueue)
      .set({ status: 'consumed', consumedAt: new Date() })
      .where(inArray(anamneseQueue.id, ids));
  }
}

@Injectable()
export class DrizzleAnamneseRunRepository implements AnamneseRunRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async create(input: NewAnamneseRun): Promise<AnamneseRun> {
    const db = currentDb(this.rootDb);
    const [row] = await db.insert(anamneseRuns).values(input).returning();
    return toRun(row);
  }

  async findLatest(projectId: string): Promise<AnamneseRun | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(anamneseRuns)
      .where(eq(anamneseRuns.projectId, projectId))
      .orderBy(desc(anamneseRuns.windowTo))
      .limit(1);
    return row ? toRun(row) : null;
  }
}

function toQueueEntry(
  row: typeof anamneseQueue.$inferSelect,
): AnamneseQueueEntry {
  return {
    id: row.id,
    projectId: row.projectId,
    origin: row.origin,
    hypothesisId: row.hypothesisId,
    status: row.status as 'pending' | 'consumed',
    createdAt: row.createdAt,
    consumedAt: row.consumedAt,
  };
}

function toRun(row: typeof anamneseRuns.$inferSelect): AnamneseRun {
  return {
    id: row.id,
    projectId: row.projectId,
    sessionId: row.sessionId,
    windowFrom: row.windowFrom,
    windowTo: row.windowTo,
    eventCount: row.eventCount,
    profileCount: row.profileCount,
    createdAt: row.createdAt,
  };
}
