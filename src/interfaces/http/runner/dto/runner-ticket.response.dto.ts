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
      'Token opaco de uso único, base64url. TTL de 30s: some depois do ' +
      'primeiro `connect/3` bem-sucedido no socket `/runner`, ou quando expira.',
  })
  ticket!: string;

  @ApiProperty({
    example: '2026-08-09T12:00:30.000Z',
    description: 'Quando o ticket expira (ISO 8601).',
  })
  expiresAt!: string;

  @ApiProperty({
    example: 'ws://localhost:4000/runner',
    description:
      'URL pública do socket Phoenix `/runner`, já em ws(s):// — pronta para ' +
      'o cliente (runner CLI ou web) abrir a conexão com `{ticket}` nos params.',
  })
  engineWsUrl!: string;
}
