import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { SessionLanguageOverrideRepository } from '../../../application/ports/session-language-override-repository.port';
import { sessionLanguageOverrides } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleSessionLanguageOverrideRepository extends SessionLanguageOverrideRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {
    super();
  }

  async find(sessionId: string, userId: string): Promise<string | null> {
    const db = currentDb(this.rootDb);
    const [linha] = await db
      .select({ language: sessionLanguageOverrides.language })
      .from(sessionLanguageOverrides)
      .where(
        and(
          eq(sessionLanguageOverrides.sessionId, sessionId),
          eq(sessionLanguageOverrides.userId, userId),
        ),
      );
    return linha?.language ?? null;
  }

  async set(
    sessionId: string,
    userId: string,
    language: string,
  ): Promise<void> {
    const db = currentDb(this.rootDb);
    await db
      .insert(sessionLanguageOverrides)
      .values({ sessionId, userId, language })
      .onConflictDoUpdate({
        target: [
          sessionLanguageOverrides.sessionId,
          sessionLanguageOverrides.userId,
        ],
        set: { language, updatedAt: new Date() },
      });
  }

  async clear(sessionId: string, userId: string): Promise<void> {
    const db = currentDb(this.rootDb);
    await db
      .delete(sessionLanguageOverrides)
      .where(
        and(
          eq(sessionLanguageOverrides.sessionId, sessionId),
          eq(sessionLanguageOverrides.userId, userId),
        ),
      );
  }
}
