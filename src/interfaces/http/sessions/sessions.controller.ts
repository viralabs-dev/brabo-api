import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import type { User } from '../../../domain/iam/user.entity';
import { RequireRole } from '../iam/require-role.decorator';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { CreateSessionUseCase } from '../../../application/use-cases/sessions/create-session.use-case';
import { GetSessionUseCase } from '../../../application/use-cases/sessions/get-session.use-case';
import { ListSessionsForProjectUseCase } from '../../../application/use-cases/sessions/list-sessions-for-project.use-case';
import { RenameSessionUseCase } from '../../../application/use-cases/sessions/rename-session.use-case';
import { TransitionSessionUseCase } from '../../../application/use-cases/sessions/transition-session.use-case';
import { AppendSessionEventUseCase } from '../../../application/use-cases/sessions/append-session-event.use-case';
import { ListSessionEventsUseCase } from '../../../application/use-cases/sessions/list-session-events.use-case';
import { GetSessionEventUseCase } from '../../../application/use-cases/sessions/get-session-event.use-case';
import { CreateSocketTicketUseCase } from '../../../application/use-cases/sessions/create-socket-ticket.use-case';
import { CreateSessionDto } from './dto/create-session.dto';
import { RenameSessionDto } from './dto/rename-session.dto';
import { TransitionSessionDto } from './dto/transition-session.dto';
import { AppendSessionEventDto } from './dto/append-session-event.dto';
import { CreateSocketTicketDto } from './dto/create-socket-ticket.dto';
import { SocketTicketResponseDto } from './dto/socket-ticket.response.dto';
import {
  PaginaDeEventosResponseDto,
  SessionEventResponseDto,
  SessionResponseDto,
} from './dto/sessions.response.dto';

@ApiTags('sessions')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Insufficient role in the project.' })
@ApiNotFoundResponse({ description: 'Project or session does not exist.' })
@Controller('projects/:projectId/sessions')
export class SessionsController {
  constructor(
    private readonly createSession: CreateSessionUseCase,
    private readonly getSession: GetSessionUseCase,
    private readonly listSessionsForProject: ListSessionsForProjectUseCase,
    private readonly renameSession: RenameSessionUseCase,
    private readonly transitionSession: TransitionSessionUseCase,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
    private readonly listSessionEvents: ListSessionEventsUseCase,
    private readonly getSessionEvent: GetSessionEventUseCase,
    private readonly createSocketTicket: CreateSocketTicketUseCase,
  ) {}

  @Post()
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Opens a session in the project',
    description:
      'The session is born in `created` and is the container for everything ' +
      'agents do: the event log, proposed actions and the token budget all ' +
      'hang off it. `kind` is REQUIRED and gets recorded: `consultiva` ' +
      '(consultative) only converses, `criativa` (creative) produces and is ' +
      'the only one that accepts `execution.activated`.',
  })
  @ApiCreatedResponse({ type: SessionResponseDto })
  @ApiBadRequestResponse({
    description: 'Body without `kind`, or with a value outside the allowed list.',
  })
  create(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateSessionDto,
  ) {
    return this.createSession.execute(projectId, user.id, {
      kind: dto.kind,
      name: dto.name,
    });
  }

  /**
   * Renomear é `developer` — o mesmo papel que ABRE a sessão. Trocar um rótulo
   * de navegação não é decisão de gasto nem de autoridade (que exigiriam
   * `maintainer`), mas é escrita em estado compartilhado do projeto, e quem
   * só lê (`viewer`) não muda o que os outros veem.
   */
  @Patch(':sessionId')
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Sets or clears the session\'s friendly name',
    description:
      "The name is a navigation label and does NOT replace the id's hashtag " +
      '— screens compose the two, and without a name they degrade to just ' +
      'the hashtag. `null` or a blank string clears the name. There is no ' +
      'way to change `kind`: it is the creation intent, and changing it ' +
      'later would turn it into state.',
  })
  @ApiOkResponse({ type: SessionResponseDto })
  @ApiBadRequestResponse({
    description: 'Body without `name`, or a name above the character limit.',
  })
  rename(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: RenameSessionDto,
  ) {
    return this.renameSession.execute(projectId, sessionId, dto.name);
  }

  @Get()
  @RequireRole('viewer')
  @ApiOperation({ summary: "Lists the project's sessions" })
  @ApiOkResponse({ type: [SessionResponseDto] })
  list(@Param('projectId') projectId: string) {
    return this.listSessionsForProject.execute(projectId);
  }

  @Get(':sessionId')
  @RequireRole('viewer')
  @ApiOperation({ summary: 'Returns a session by id' })
  @ApiOkResponse({ type: SessionResponseDto })
  get(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.getSession.execute(projectId, sessionId);
  }

  @Post(':sessionId/transition')
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Moves the session to another state',
    description:
      "The transition is validated by the domain's state machine, not by the " +
      'client: created → active → closing → closed | closed_abnormally. An ' +
      'invalid jump is 409.',
  })
  @ApiCreatedResponse({
    type: SessionResponseDto,
    description:
      "Returns 201, not 200, because the handler is `@Post` without " +
      "`@HttpCode` — that's Nest's default. Documented as-is instead of " +
      "changed: the semantics are debatable, the behavior isn't defective, " +
      'and the table test fails on any divergence between the two.',
  })
  @ApiConflictResponse({
    description: 'Transition not allowed from the current state.',
  })
  transition(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: TransitionSessionDto,
  ) {
    return this.transitionSession.execute(projectId, sessionId, dto.status);
  }

  @Get(':sessionId/events')
  @RequireRole('viewer')
  @ApiOperation({
    summary: "Paginates the session's event log",
    description:
      'The log is IMMUTABLE and ordered by `seq`. Normal pagination is ' +
      "incremental: pass the previous response's `nextCursor` as `afterSeq`. " +
      '`latest=true` does the opposite — it fetches the TAIL and ignores ' +
      '`afterSeq`, for a screen that opens at the end instead of ' +
      'reconstructing the whole session from the start (ADR 0021).',
  })
  @ApiQuery({
    name: 'afterSeq',
    required: false,
    example: 40,
    description: 'Returns the events with `seq` greater than this.',
  })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiQuery({
    name: 'latest',
    required: false,
    example: 'true',
    description: 'Fetches the tail of the log; ignores `afterSeq`.',
  })
  @ApiOkResponse({ type: PaginaDeEventosResponseDto })
  listEvents(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Query('afterSeq') afterSeq?: string,
    @Query('limit') limit?: string,
    @Query('latest') latest?: string,
  ) {
    return this.listSessionEvents.execute(projectId, sessionId, {
      afterSeq: afterSeq !== undefined ? Number(afterSeq) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
      latest: latest === 'true',
    });
  }

  /**
   * Um evento pelo id — é o que faz a evidência das hipóteses do Psicólogo
   * (Fase 4b) chegar no evento citado independente de paginação e dos
   * filtros do feed. Ver GetSessionEventUseCase.
   */
  @Get(':sessionId/events/:eventId')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Returns a log event by id',
    description:
      "Exists so the Psychologist's hypothesis evidence can reach the cited " +
      "event regardless of which page it fell on or the feed's filters.",
  })
  @ApiOkResponse({ type: SessionEventResponseDto })
  getEvent(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Param('eventId') eventId: string,
  ) {
    return this.getSessionEvent.execute(projectId, sessionId, eventId);
  }

  @Post(':sessionId/events')
  @RequireRole('developer')
  @ApiOperation({
    summary: "Appends an event to the session's log",
    description:
      "Append-only: `seq` is assigned by the server and nothing in the log " +
      'is updated or removed afterward. There is no edit endpoint, by design.',
  })
  @ApiCreatedResponse({ type: SessionEventResponseDto })
  appendEvent(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: AppendSessionEventDto,
  ) {
    return this.appendSessionEvent.execute(projectId, sessionId, dto);
  }

  /**
   * Fecha o gap descrito no moduledoc de `EngineWeb.SessionSocket` (RN-108):
   * antes deste ticket, `connect/3` do socket Phoenix da sessão não exigia
   * nada além do `session_id` existir. `@RequireRole('viewer')` é o MÍNIMO
   * comum aos dois escopos; `terminal` exige `developer` — checado dentro do
   * use case contra `request.effectiveRole`, que o `RolesGuard` já resolveu
   * para não repetir a consulta de papel efetivo.
   */
  @Post(':sessionId/socket-ticket')
  @RequireRole('viewer')
  @ApiOperation({
    summary: "Issues an opaque, single-use ticket for the session's socket",
    description:
      "The ticket authenticates the session's Phoenix socket " +
      '`session:<id>` `connect/3` on the engine — it is NOT the reused JWT. ' +
      '30s TTL and single use: every reconnection (including automatic ones) ' +
      'requests a new ticket. `scope: "heartbeat"` requires the `viewer` ' +
      'role; `scope: "terminal"` requires `developer`, the same minimum ' +
      'role as terminal actions.',
  })
  @ApiCreatedResponse({ type: SocketTicketResponseDto })
  @ApiForbiddenResponse({
    description: 'Insufficient role for the requested scope.',
  })
  issueSocketTicket(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: User,
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateSocketTicketDto,
  ) {
    return this.createSocketTicket
      .execute(projectId, sessionId, user.id, request.effectiveRole!, dto.scope)
      .then((emitido) => ({
        ticket: emitido.ticket,
        expiresAt: emitido.expiresAt.toISOString(),
      }));
  }
}
