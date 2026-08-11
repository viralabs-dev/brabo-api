import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import {
  SOCKET_TICKET_SCOPES,
  type SocketTicketScope,
} from '../../../../domain/sessions/socket-ticket-scope';

/** Corpo de `POST /projects/:projectId/sessions/:sessionId/socket-ticket` (RN-108). */
export class CreateSocketTicketDto {
  @ApiProperty({
    enum: SOCKET_TICKET_SCOPES,
    example: 'heartbeat',
    description:
      '`heartbeat` exige papel `viewer`; `terminal` exige `developer` — o ' +
      'mesmo papel mínimo de `MIN_ROLE_FOR_ACTION_TYPE.terminal`.',
  })
  @IsIn(SOCKET_TICKET_SCOPES)
  scope!: SocketTicketScope;
}
