import { Inject, Injectable } from '@nestjs/common';
import {
  SessionSocketTicketRepository,
  type NovoSocketTicket,
} from '../../../application/ports/session-socket-ticket-repository.port';
import { sessionSocketTickets } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleSessionSocketTicketRepository extends SessionSocketTicketRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {
    super();
  }

  async emitir(novo: NovoSocketTicket): Promise<void> {
    const db = currentDb(this.rootDb);
    await db.insert(sessionSocketTickets).values({
      sessionId: novo.sessionId,
      projectId: novo.projectId,
      userId: novo.userId,
      scope: novo.scope,
      ticketHash: novo.ticketHash,
      expiresAt: novo.expiresAt,
    });
  }
}
