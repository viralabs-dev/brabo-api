import type { SocketTicketScope } from '../../domain/sessions/socket-ticket-scope';

export interface NovoSocketTicket {
  sessionId: string;
  projectId: string;
  userId: string;
  scope: SocketTicketScope;
  /** SHA-256 puro do token bruto — ver comentário em `db/schema.ts`. */
  ticketHash: string;
  expiresAt: Date;
}

/**
 * A api só EMITE tickets (RN-108). O consumo — a checagem de uso único que
 * derruba o reuso — roda no ENGINE, que lê `session_socket_tickets` direto
 * (mesmo padrão de `Engine.Outbox.Event` sobre `outbox_events`): não há
 * round-trip de volta à api no caminho de `connect/3`.
 */
export abstract class SessionSocketTicketRepository {
  abstract emitir(novo: NovoSocketTicket): Promise<void>;
}
