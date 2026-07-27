import { Inject, Injectable } from '@nestjs/common';
import { AuthEventRecorder } from '../../../application/ports/auth-event-recorder.port';
import type { AuthEventParaGravar } from '../../../domain/auth/auth-event';
import { authEvents } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

/**
 * Append-only: só `insert`. Não existe update nem delete nesta classe, e é
 * essa ausência que garante a imutabilidade — igual a
 * `DrizzleSessionEventRepository`, sem trigger no banco (o schema deste
 * repositório não tem nenhum).
 */
@Injectable()
export class DrizzleAuthEventRepository extends AuthEventRecorder {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {
    super();
  }

  async registrar(evento: AuthEventParaGravar): Promise<void> {
    const db = currentDb(this.rootDb);
    await db.insert(authEvents).values({
      kind: evento.kind,
      subjectKey: evento.subjectKey,
      userId: evento.userId ?? null,
      ip: evento.ip ?? null,
      userAgent: evento.userAgent ?? null,
      metadata: evento.metadata ?? {},
    });
  }
}
