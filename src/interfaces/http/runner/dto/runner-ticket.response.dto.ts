import { ApiProperty } from '@nestjs/swagger';

/**
 * Resposta de `POST /projects/:projectId/runner-ticket` e
 * `POST /projects/:projectId/terminal-ticket`.
 *
 * Não implementa `Wire<T>` pelo mesmo motivo de `SocketTicketResponseDto`:
 * não espelha entidade persistida, é a forma de saída do
 * `RequestRunnerTicketUseCase`.
 */
export class RunnerTicketResponseDto {
  @ApiProperty({
    description:
      'Opaque single-use token, base64url. 30s TTL: gone after the first ' +
      'successful `connect/3` on the `/runner` socket, or when it expires.',
  })
  ticket!: string;

  @ApiProperty({
    example: '2026-08-09T12:00:30.000Z',
    description: 'When the ticket expires (ISO 8601).',
  })
  expiresAt!: string;

  @ApiProperty({
    example: 'ws://localhost:4000/runner',
    description:
      'Public URL of the Phoenix `/runner` socket, already in ws(s):// — ready ' +
      'for the client (runner CLI or web) to open the connection with `{ticket}` in the params.',
  })
  engineWsUrl!: string;
}
