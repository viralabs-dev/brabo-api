import { IsIn } from 'class-validator';
import {
  SESSION_STATUSES,
  type SessionStatus,
} from '../../../../domain/sessions/session-state-machine';

export class TransitionSessionDto {
  @IsIn(SESSION_STATUSES)
  status!: SessionStatus;
}
