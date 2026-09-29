import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  DeteccaoDeIdiomaRepository,
  type EventoDeEvidencia,
} from '../../../application/ports/deteccao-de-idioma-repository.port';
import {
  detectedLanguageDeclines,
  sessionEvents,
  users,
} from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

/** Os dois tipos que são evidência — os MESMOS do índice parcial. */
const TIPOS_DE_EVIDENCIA = [
  'chat.message',
  'chat.structured_question_answered',
] as const;

@Injectable()
export class DrizzleDeteccaoDeIdiomaRepository extends DeteccaoDeIdiomaRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {
    super();
  }

  async ultimasEvidencias(
    userId: string,
    limite: number,
  ): Promise<EventoDeEvidencia[]> {
    const db = currentDb(this.rootDb);
    // O predicado repete o do índice parcial LITERALMENTE (`actor_kind`,
    // `type IN (...)`) — é isso que deixa o planejador usá-lo — e o
    // `ORDER BY created_at DESC LIMIT n` para nas n linhas mais novas.
    const linhas = await db
      .select({
        sessionId: sessionEvents.sessionId,
        tipo: sessionEvents.type,
        payload: sessionEvents.payload,
      })
      .from(sessionEvents)
      .where(
        and(
          eq(sessionEvents.actorKind, 'user'),
          eq(sessionEvents.actorId, userId),
          inArray(sessionEvents.type, [...TIPOS_DE_EVIDENCIA]),
        ),
      )
      .orderBy(desc(sessionEvents.createdAt), desc(sessionEvents.seq))
      .limit(limite);
    return linhas.reverse().map((l) => ({
      sessionId: l.sessionId,
      tipo: l.tipo,
      payload: l.payload ?? {},
    }));
  }

  async recusados(userId: string): Promise<string[]> {
    const db = currentDb(this.rootDb);
    const linhas = await db
      .select({ language: detectedLanguageDeclines.language })
      .from(detectedLanguageDeclines)
      .where(eq(detectedLanguageDeclines.userId, userId));
    return linhas.map((l) => l.language);
  }

  async recusar(userId: string, idioma: string): Promise<void> {
    const db = currentDb(this.rootDb);
    await db
      .insert(detectedLanguageDeclines)
      .values({ userId, language: idioma })
      .onConflictDoNothing();
  }

  async confirmar(userId: string, idioma: string, em: Date): Promise<void> {
    const db = currentDb(this.rootDb);
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          detectedLanguage: idioma,
          detectedLanguageConfirmedAt: em,
          updatedAt: em,
        })
        .where(eq(users.id, userId));
      await tx
        .delete(detectedLanguageDeclines)
        .where(
          and(
            eq(detectedLanguageDeclines.userId, userId),
            eq(detectedLanguageDeclines.language, idioma),
          ),
        );
    });
  }
}
