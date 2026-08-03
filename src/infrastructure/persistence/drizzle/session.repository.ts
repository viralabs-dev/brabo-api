import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { SessionRepository } from '../../../application/ports/session-repository.port';
import type { Session } from '../../../domain/sessions/session.entity';
import type { SessionStatus } from '../../../domain/sessions/session-state-machine';
import { sessionEvents, sessions } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleSessionRepository implements SessionRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async create(input: {
    projectId: string;
    createdBy: string;
    traceParent?: string | null;
  }): Promise<Session> {
    const db = currentDb(this.rootDb);
    const [row] = await db.insert(sessions).values(input).returning();
    return row;
  }

  async findInProject(
    projectId: string,
    sessionId: string,
  ): Promise<Session | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(sessions)
      .where(
        and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)),
      );
    return row ?? null;
  }

  async listForProject(projectId: string): Promise<Session[]> {
    const db = currentDb(this.rootDb);
    return db.select().from(sessions).where(eq(sessions.projectId, projectId));
  }

  async findActiveExecutionSession(
    projectId: string,
  ): Promise<Session | null> {
    const db = currentDb(this.rootDb);
    // O join pode repetir a sessão (nada impede dois `execution.activated` na
    // mesma), mas o `limit(1)` sobre a ordem já resolve — a linha repetida é a
    // mesma sessão.
    const [row] = await db
      .select({ session: sessions })
      .from(sessions)
      .innerJoin(sessionEvents, eq(sessionEvents.sessionId, sessions.id))
      .where(
        and(
          eq(sessions.projectId, projectId),
          eq(sessions.status, 'active'),
          eq(sessionEvents.type, 'execution.activated'),
        ),
      )
      .orderBy(desc(sessions.createdAt), desc(sessions.id))
      .limit(1);
    return row?.session ?? null;
  }

  async findInProjectForUpdate(
    projectId: string,
    sessionId: string,
  ): Promise<Session | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)))
      .for('update');
    return row ?? null;
  }

  async updateStatus(
    sessionId: string,
    status: SessionStatus,
    closedAt: Date | null,
    terminationReason?: string | null,
  ): Promise<Session> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(sessions)
      .set({
        status,
        updatedAt: new Date(),
        closedAt,
        ...(terminationReason !== undefined ? { terminationReason } : {}),
      })
      .where(eq(sessions.id, sessionId))
      .returning();
    return row;
  }

  async incrementSeq(
    projectId: string,
    sessionId: string,
  ): Promise<number | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(sessions)
      .set({ nextSeq: sql`${sessions.nextSeq} + 1` })
      .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)))
      .returning({ nextSeq: sessions.nextSeq });
    return row ? row.nextSeq - 1 : null;
  }
}
