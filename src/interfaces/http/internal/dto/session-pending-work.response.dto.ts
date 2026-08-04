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
      'Há trabalho que impede encerrar por inatividade da aba. Hoje: handoff ' +
      '`offered` aguardando aceite.',
  })
  pending!: boolean;

  @ApiProperty({
    example: 'handoff po → arquiteto aguardando aceite',
    nullable: true,
    description: 'O que está pendurado. `null` quando não há nada.',
  })
  motivo!: string | null;
}
