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
  @ApiProperty({ example: EXEMPLO_ID, description: 'ULID da sessão.' })
  id!: string;

  @ApiProperty({ example: '01JC4Z0000PROJETO0000000001' })
  projectId!: string;

  @ApiProperty({
    example: '01JC4Z0000USUARIO0000000001',
    description: 'Quem abriu a sessão.',
  })
  createdBy!: string;

  @ApiProperty({
    enum: ['created', 'active', 'closing', 'closed', 'closed_abnormally'],
    example: 'active',
    description:
      'Máquina de estados explícita: created → active → closing → closed | closed_abnormally. ' +
      'Transição inválida responde 409.',
  })
  status!: Wire<Session>['status'];

  @ApiProperty({
    enum: SESSION_KINDS,
    example: 'criativa',
    description:
      'A INTENÇÃO com que a sessão foi aberta, escolhida na criação e imutável. ' +
      '`consultiva` é só conversa; `criativa` produz e é a única que entra em ' +
      'execução. Não confundir com estado de execução, que continua sendo o ' +
      'evento `execution.activated` no log.',
  })
  kind!: Wire<Session>['kind'];

  @ApiProperty({
    example: 'Checkout do carrinho',
    nullable: true,
    description:
      'Nome amigável, ou `null`. As telas o compõem com a hashtag do id; ele ' +
      'nunca a substitui.',
  })
  name!: string | null;

  @ApiProperty({
    example: 42,
    description:
      'Próximo `seq` do event log. Serve de cursor: `?afterSeq=41` traz tudo depois do 41.',
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
    description: 'Preenchido só nos estados terminais.',
  })
  closedAt!: string | null;

  @ApiProperty({
    example: null,
    nullable: true,
    description:
      'Motivo reportado pelo engine ao terminar (heartbeat_timeout, killed, exceção…). ' +
      '`null` em fechamento humano ou sessão ainda viva.',
  })
  terminationReason!: string | null;

  @ApiProperty({
    example: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    nullable: true,
    description:
      '`traceparent` W3C da span raiz. É por ele que a sessão inteira se recupera no Tempo.',
  })
  traceParent!: string | null;
}
export const _chavesSession: MesmasChaves<SessionResponseDto, Session> = true;

export class SessionEventResponseDto implements Wire<SessionEvent> {
  @ApiProperty({
    example: '01JC4Z8QK3M7YV2N5T9B0PXHRB',
    description: 'ULID do evento.',
  })
  id!: string;

  @ApiProperty({ example: EXEMPLO_ID })
  sessionId!: string;

  @ApiProperty({
    example: 41,
    description: 'Ordem dentro da sessão. Monotônico e sem buracos.',
  })
  seq!: number;

  @ApiProperty({
    example: 'chat.message',
    description:
      'Tipo do evento. O inventário completo está em `docs/reference/events.md`.',
  })
  type!: string;

  @ApiProperty({ type: ActorResponseDto })
  actor!: ActorResponseDto;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { role: 'assistant', content: 'Vou abrir o épico primeiro.' },
    description:
      'Forma livre, específica de cada `type`. Ver a referência de eventos.',
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
      'Passe como `afterSeq` para a próxima página. `null` significa fim do log.',
  })
  nextCursor!: number | null;
}
export const _chavesPagina: MesmasChaves<
  PaginaDeEventosResponseDto,
  Page<SessionEvent>
> = true;
