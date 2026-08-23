import { ApiProperty } from '@nestjs/swagger';
import { ActorResponseDto } from '../../shared/dto/comuns.response.dto';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';
import { SESSION_KINDS } from '../../../../domain/sessions/session-kind';
import type { Session } from '../../../../domain/sessions/session.entity';
import type { SessionEvent } from '../../../../domain/sessions/session-event.entity';
import type { Page } from '../../../../application/ports/session-event-repository.port';

/**
 * Respostas do domínio de sessões (Fase 7b, item 6).
 *
 * `implements Wire<T>` mais a linha `_chaves` no fim de cada classe: as duas
 * juntas garantem que o DTO tem EXATAMENTE os campos da entidade, com os tipos
 * que de fato saem no JSON. Ver `shared/dto/wire.ts` para o porquê de as duas
 * serem necessárias.
 */

const EXEMPLO_ID = '01JC4Z8QK3M7YV2N5T9B0PXHRA';

export class SessionResponseDto implements Wire<Session> {
  @ApiProperty({ example: EXEMPLO_ID, description: "The session's ULID." })
  id!: string;

  @ApiProperty({ example: '01JC4Z0000PROJETO0000000001' })
  projectId!: string;

  @ApiProperty({
    example: '01JC4Z0000USUARIO0000000001',
    description: 'Who opened the session.',
  })
  createdBy!: string;

  @ApiProperty({
    enum: ['created', 'active', 'closing', 'closed', 'closed_abnormally'],
    example: 'active',
    description:
      'Explicit state machine: created → active → closing → closed | ' +
      'closed_abnormally. An invalid transition responds 409.',
  })
  status!: Wire<Session>['status'];

  @ApiProperty({
    enum: SESSION_KINDS,
    example: 'criativa',
    description:
      'The INTENT with which the session was opened, chosen at creation and ' +
      'immutable. `consultiva` (consultative) is conversation only; ' +
      '`criativa` (creative) produces and is the only one that enters ' +
      'execution. Not to be confused with execution state, which remains ' +
      'the `execution.activated` event in the log.',
  })
  kind!: Wire<Session>['kind'];

  @ApiProperty({
    example: 'Cart checkout',
    nullable: true,
    description:
      "Friendly name, or `null`. Screens compose it with the id's hashtag; " +
      'it never replaces it.',
  })
  name!: string | null;

  @ApiProperty({
    example: 42,
    description:
      'Next `seq` of the event log. Serves as a cursor: `?afterSeq=41` fetches everything after 41.',
  })
  nextSeq!: number;

  @ApiProperty({ example: '2026-07-27T14:03:22.187Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-27T14:31:09.004Z', format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({
    example: null,
    format: 'date-time',
    nullable: true,
    description: 'Only filled in terminal states.',
  })
  closedAt!: string | null;

  @ApiProperty({
    example: null,
    nullable: true,
    description:
      'Reason reported by the engine when terminating (heartbeat_timeout, ' +
      'killed, exception…). `null` on a human close or a still-live session.',
  })
  terminationReason!: string | null;

  @ApiProperty({
    example: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    nullable: true,
    description:
      "W3C `traceparent` of the root span. This is how the whole session is " +
      'recovered in Tempo.',
  })
  traceParent!: string | null;
}
export const _chavesSession: MesmasChaves<SessionResponseDto, Session> = true;

export class SessionEventResponseDto implements Wire<SessionEvent> {
  @ApiProperty({
    example: '01JC4Z8QK3M7YV2N5T9B0PXHRB',
    description: "The event's ULID.",
  })
  id!: string;

  @ApiProperty({ example: EXEMPLO_ID })
  sessionId!: string;

  @ApiProperty({
    example: 41,
    description: 'Order within the session. Monotonic and gapless.',
  })
  seq!: number;

  @ApiProperty({
    example: 'chat.message',
    description:
      'Event type. The full inventory is in `docs/reference/events.md`.',
  })
  type!: string;

  @ApiProperty({ type: ActorResponseDto })
  actor!: ActorResponseDto;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { role: 'assistant', content: "I'll open the epic first." },
    description:
      'Free-form shape, specific to each `type`. See the events reference.',
  })
  payload!: unknown;

  @ApiProperty({ example: '2026-07-27T14:30:58.512Z', format: 'date-time' })
  createdAt!: string;
}
export const _chavesEvento: MesmasChaves<
  SessionEventResponseDto,
  SessionEvent
> = true;

export class PaginaDeEventosResponseDto implements Wire<Page<SessionEvent>> {
  @ApiProperty({ type: [SessionEventResponseDto] })
  items!: SessionEventResponseDto[];

  @ApiProperty({
    example: 41,
    nullable: true,
    description:
      'Pass as `afterSeq` for the next page. `null` means end of the log.',
  })
  nextCursor!: number | null;
}
export const _chavesPagina: MesmasChaves<
  PaginaDeEventosResponseDto,
  Page<SessionEvent>
> = true;
