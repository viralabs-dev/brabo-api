import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import {
  SESSION_STATUSES,
  type SessionStatus,
} from '../../../../domain/sessions/session-state-machine';

export class TransitionSessionDto {
  @ApiProperty({
    enum: SESSION_STATUSES,
    example: 'closing',
    description:
      'Estado de destino. A máquina de estados recusa salto inválido com 409 — ' +
      'de `created` só se vai para `active`, e de um terminal não se volta.',
  })
  @IsIn(SESSION_STATUSES)
  status!: SessionStatus;
}
