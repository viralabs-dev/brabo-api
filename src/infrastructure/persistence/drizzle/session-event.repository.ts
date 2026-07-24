import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt } from 'drizzle-orm';
import {
  SessionEventRepository,
  type ListPaginatedOptions,
  type NewSessionEvent,
  type Page,
} from '../../../application/ports/session-event-repository.port';
import type { SessionEvent } from '../../../domain/sessions/session-event.entity';
import { sessionEvents, sessions } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

@Injectable()
export class DrizzleSessionEventRepository implements SessionEventRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async append(input: NewSessionEvent): Promise<SessionEvent> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .insert(sessionEvents)
      .values({
        id: input.id,
        sessionId: input.sessionId,
        seq: input.seq,
        type: input.type,
        actorKind: input.actor.kind,
        actorId: input.actor.id,
        payload: input.payload,
      })
      .returning();
    return toEntity(row);
  }

  async listPaginated(
    sessionId: string,
    opts: ListPaginatedOptions,
  ): Promise<Page<SessionEvent>> {
    const db = currentDb(this.rootDb);
    const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const conditions = [eq(sessionEvents.sessionId, sessionId)];
    if (opts.afterSeq !== undefined) {
      conditions.push(gt(sessionEvents.seq, opts.afterSeq));
    }

    const rows = await db
      .select()
      .from(sessionEvents)
      .where(and(...conditions))
      .orderBy(asc(sessionEvents.seq))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: page.map(toEntity),
      nextCursor: hasMore ? page[page.length - 1].seq : null,
    };
  }

  async findById(id: string): Promise<SessionEvent | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.id, id))
      .limit(1);
    return row ? toEntity(row) : null;
  }

  async listByTypeForProject(
    projectId: string,
    type: string,
  ): Promise<SessionEvent[]> {
    const db = currentDb(this.rootDb);
    const rows = await db
      .select()
      .from(sessionEvents)
      .innerJoin(sessions, eq(sessionEvents.sessionId, sessions.id))
      .where(
        and(eq(sessions.projectId, projectId), eq(sessionEvents.type, type)),
      )
      .orderBy(asc(sessionEvents.createdAt));
    return rows.map((r) => toEntity(r.session_events));
  }
}

function toEntity(row: typeof sessionEvents.$inferSelect): SessionEvent {
  return {
    id: row.id,
    sessionId: row.sessionId,
    seq: row.seq,
    type: row.type,
    actor: { kind: row.actorKind, id: row.actorId },
    payload: row.payload,
    createdAt: row.createdAt,
  };
}
