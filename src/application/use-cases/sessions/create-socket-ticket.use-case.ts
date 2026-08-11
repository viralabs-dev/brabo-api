import { createHash, randomBytes } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SessionRepository } from '../../ports/session-repository.port';
import { SessionSocketTicketRepository } from '../../ports/session-socket-ticket-repository.port';
import { roleAtLeast, type Role } from '../../../domain/iam/role';
import {
  minRoleForSocketTicketScope,
  type SocketTicketScope,
} from '../../../domain/sessions/socket-ticket-scope';

/**
 * TTL do ticket (RN-108). Curto de propósito: o ticket é de uso único e vive
 * só o tempo do `connect/3` seguinte — reconexão automática do socket sempre
 * busca um ticket NOVO (ver `apps/web/src/lib/session-channel.ts`), nunca
 * reusa um velho.
 */
export const SOCKET_TICKET_TTL_MS = 30_000;

export interface SocketTicketEmitido {
  ticket: string;
  expiresAt: Date;
}

@Injectable()
export class CreateSocketTicketUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly tickets: SessionSocketTicketRepository,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    userId: string,
    effectiveRole: Role,
    scope: SocketTicketScope,
  ): Promise<SocketTicketEmitido> {
    const session = await this.sessions.findInProject(projectId, sessionId);
    if (!session) throw new NotFoundException('Sessão não encontrada');

    const minRole = minRoleForSocketTicketScope(scope);
    if (!roleAtLeast(effectiveRole, minRole)) {
      throw new ForbiddenException(
        `Papel insuficiente para pedir ticket de escopo "${scope}"`,
      );
    }

    // 32 bytes de CSPRNG — mesma escolha de TokenFactory (refresh/tokens de
    // conta), pelo mesmo motivo: 256 bits não têm dicionário possível.
    const bruto = randomBytes(32).toString('base64url');
    // SHA-256 PURO, não `hashDeToken` (HMAC com pepper) — ver o comentário em
    // `db/schema.ts` sobre `sessionSocketTickets`: quem verifica é o engine,
    // que lê a tabela direto e não tem o pepper da api.
    const ticketHash = createHash('sha256').update(bruto).digest('hex');
    const expiresAt = new Date(Date.now() + SOCKET_TICKET_TTL_MS);

    await this.tickets.emitir({
      sessionId,
      projectId,
      userId,
      scope,
      ticketHash,
      expiresAt,
    });

    return { ticket: bruto, expiresAt };
  }
}
