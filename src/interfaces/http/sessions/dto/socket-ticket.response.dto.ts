import { ApiProperty } from '@nestjs/swagger';

/**
 * Resposta de `POST /projects/:projectId/sessions/:sessionId/socket-ticket`
 * (RN-108).
 *
 * Não implementa `Wire<T>` porque não espelha uma entidade persistida — é a
 * forma de saída do `CreateSocketTicketUseCase`, igual a `SessaoResponseDto`
 * do auth first-party.
 */
export class SocketTicketResponseDto {
  @ApiProperty({
    description:
      'Opaque, single-use, base64url token. 30s TTL and single use: it ' +
      "disappears after the first successful `connect/3`, or when it expires.",
  })
  ticket!: string;

  @ApiProperty({
    example: '2026-08-09T12:00:30.000Z',
    description: 'When the ticket expires (ISO 8601).',
  })
  expiresAt!: string;
}
