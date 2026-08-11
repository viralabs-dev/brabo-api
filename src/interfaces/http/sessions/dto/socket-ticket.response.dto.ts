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
      'Token opaco de uso único, base64url. TTL de 30s e uso único: some ' +
      'depois do primeiro `connect/3` bem-sucedido, ou quando expira.',
  })
  ticket!: string;

  @ApiProperty({
    example: '2026-08-09T12:00:30.000Z',
    description: 'Quando o ticket expira (ISO 8601).',
  })
  expiresAt!: string;
}
