import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  RagTelemetryRepository,
  type NewRagFeedback,
  type NewRagSearch,
  type RagFeedbackRecord,
  type RagSearchRecord,
} from '../../../application/ports/rag-telemetry-repository.port';
import { ragFeedback, ragSearches } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleRagTelemetryRepository implements RagTelemetryRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async recordSearch(input: NewRagSearch): Promise<RagSearchRecord> {
    const db = currentDb(this.rootDb);
    const [row] = await db.insert(ragSearches).values(input).returning();
    return toSearch(row);
  }

  async findSearchById(id: string): Promise<RagSearchRecord | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(ragSearches)
      .where(eq(ragSearches.id, id))
      .limit(1);
    return row ? toSearch(row) : null;
  }

  /**
   * `onConflictDoUpdate` sobre a unique `(search_id, chunk_id, actor_id)`:
   * mudar de ideia sobre o mesmo trecho SOBRESCREVE o próprio voto. Um segundo
   * INSERT faria o mesmo ator pesar duas vezes na `precision@k`, e a métrica
   * passaria a medir entusiasmo em vez de acerto.
   */
  async recordFeedback(input: NewRagFeedback): Promise<RagFeedbackRecord> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .insert(ragFeedback)
      .values(input)
      .onConflictDoUpdate({
        target: [
          ragFeedback.searchId,
          ragFeedback.chunkId,
          ragFeedback.actorId,
        ],
        set: { verdict: input.verdict, createdAt: new Date() },
      })
      .returning();
    return {
      id: row.id,
      searchId: row.searchId,
      chunkId: row.chunkId,
      verdict: row.verdict,
      actorKind: row.actorKind,
      actorId: row.actorId,
      createdAt: row.createdAt,
    };
  }
}

function toSearch(row: typeof ragSearches.$inferSelect): RagSearchRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    sessionId: row.sessionId,
    actorKind: row.actorKind,
    actorId: row.actorId,
    query: row.query,
    topK: row.topK,
    hits: row.hits,
    degraded: row.degraded,
    vectorAvailable: row.vectorAvailable,
    pesos: row.pesos,
    latencyMs: row.latencyMs,
    createdAt: row.createdAt,
  };
}
