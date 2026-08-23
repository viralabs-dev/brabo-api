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
      "There is work that blocks closing due to tab inactivity. Today: an " +
      '`offered` handoff waiting for acceptance.',
  })
  pending!: boolean;

  @ApiProperty({
    example: 'handoff po → arquiteto aguardando aceite',
    nullable: true,
    description: "What is hanging. `null` when there's nothing.",
  })
  motivo!: string | null;
}
