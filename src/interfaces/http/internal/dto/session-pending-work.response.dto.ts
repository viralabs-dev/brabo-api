import { ApiProperty } from '@nestjs/swagger';

/**
 * A resposta que decide se o heartbeat pode encerrar a sessão (RN-064).
 *
 * `motivo` não é enfeite: sessão que se recusa a fechar sem dizer por quê é
 * indiagnosticável, e o engine escreve esta frase no log.
 */
export class SessionPendingWorkResponseDto {
  @ApiProperty({
    example: true,
    description:
      'There is work that blocks closing due to tab inactivity: an `offered` ' +
      'handoff, a `pending` action, an agent mid-turn, a dev agent working or ' +
      'blocked, or a conversational agent waiting for the user (RN-064, RN-581).',
  })
  pending!: boolean;

  @ApiProperty({
    example: 'handoff po → arquiteto aguardando aceite',
    nullable: true,
    description: "What is hanging. `null` when there's nothing.",
  })
  motivo!: string | null;

  @ApiProperty({
    example: '2026-09-18T12:00:00.000Z',
    nullable: true,
    type: String,
    description:
      'Set ONLY when the one thing pending is a conversational agent waiting ' +
      'for the user (RN-581): the instant its turn ended. It is the only ' +
      'pending signal with a ceiling, and the engine applies it ' +
      '(`SESSION_CONVERSATION_IDLE_TIMEOUT_MS`, default 8h) — past it the ' +
      'session closes with `conversation_idle_timeout`. `null` otherwise.',
  })
  aguardandoUsuarioDesde!: string | null;
}
