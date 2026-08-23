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
      'Target state. The state machine refuses an invalid jump with 409 — ' +
      'from `created` you can only go to `active`, and there is no going ' +
      'back from a terminal state.',
  })
  @IsIn(SESSION_STATUSES)
  status!: SessionStatus;
}
