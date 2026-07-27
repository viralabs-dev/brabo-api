import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
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
import type { User } from '../../../domain/iam/user.entity';
import { RequireRole } from '../iam/require-role.decorator';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { CreateSessionUseCase } from '../../../application/use-cases/sessions/create-session.use-case';
import { GetSessionUseCase } from '../../../application/use-cases/sessions/get-session.use-case';
import { ListSessionsForProjectUseCase } from '../../../application/use-cases/sessions/list-sessions-for-project.use-case';
import { TransitionSessionUseCase } from '../../../application/use-cases/sessions/transition-session.use-case';
import { AppendSessionEventUseCase } from '../../../application/use-cases/sessions/append-session-event.use-case';
import { ListSessionEventsUseCase } from '../../../application/use-cases/sessions/list-session-events.use-case';
import { GetSessionEventUseCase } from '../../../application/use-cases/sessions/get-session-event.use-case';
import { TransitionSessionDto } from './dto/transition-session.dto';
import { AppendSessionEventDto } from './dto/append-session-event.dto';
import {
  PaginaDeEventosResponseDto,
  SessionEventResponseDto,
  SessionResponseDto,
} from './dto/sessions.response.dto';

@ApiTags('sessões')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Papel insuficiente no projeto.' })
@ApiNotFoundResponse({ description: 'Projeto ou sessão inexistente.' })
@Controller('projects/:projectId/sessions')
export class SessionsController {
  constructor(
    private readonly createSession: CreateSessionUseCase,
    private readonly getSession: GetSessionUseCase,
    private readonly listSessionsForProject: ListSessionsForProjectUseCase,
    private readonly transitionSession: TransitionSessionUseCase,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
    private readonly listSessionEvents: ListSessionEventsUseCase,
    private readonly getSessionEvent: GetSessionEventUseCase,
  ) {}

  @Post()
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Abre uma sessão no projeto',
    description:
      'A sessão nasce em `created` e é o contêiner de tudo o que os agentes fazem: ' +
      'o event log, as ações propostas e o orçamento de tokens penduram nela.',
  })
  @ApiCreatedResponse({ type: SessionResponseDto })
  create(@Param('projectId') projectId: string, @CurrentUser() user: User) {
    return this.createSession.execute(projectId, user.id);
  }

  @Get()
  @RequireRole('viewer')
  @ApiOperation({ summary: 'Lista as sessões do projeto' })
  @ApiOkResponse({ type: [SessionResponseDto] })
  list(@Param('projectId') projectId: string) {
    return this.listSessionsForProject.execute(projectId);
  }

  @Get(':sessionId')
  @RequireRole('viewer')
  @ApiOperation({ summary: 'Devolve uma sessão pelo id' })
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
    summary: 'Move a sessão para outro estado',
    description:
      'A transição é validada pela máquina de estados do domínio, não pelo cliente: ' +
      'created → active → closing → closed | closed_abnormally. Salto inválido é 409.',
  })
  @ApiCreatedResponse({
    type: SessionResponseDto,
    description:
      'Devolve 201, e não 200, porque o handler é `@Post` sem `@HttpCode` — é o ' +
      'default do Nest. Documentado como está em vez de mudado: a semântica é ' +
      'discutível, o comportamento não tem defeito, e o teste de tabela reprova ' +
      'qualquer divergência entre os dois.',
  })
  @ApiConflictResponse({
    description: 'Transição não permitida a partir do estado atual.',
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
    summary: 'Pagina o event log da sessão',
    description:
      'O log é IMUTÁVEL e ordenado por `seq`. A paginação normal é incremental: ' +
      'passe o `nextCursor` da resposta anterior como `afterSeq`. `latest=true` faz ' +
      'o caminho oposto — traz a CAUDA e ignora `afterSeq`, para uma tela que abre ' +
      'no fim em vez de reconstruir a sessão inteira desde o começo (ADR 0021).',
  })
  @ApiQuery({
    name: 'afterSeq',
    required: false,
    example: 40,
    description: 'Devolve os eventos com `seq` maior que este.',
  })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiQuery({
    name: 'latest',
    required: false,
    example: 'true',
    description: 'Traz a cauda do log; ignora `afterSeq`.',
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
    summary: 'Devolve um evento do log pelo id',
    description:
      'Existe para a evidência das hipóteses do Psicólogo chegar no evento citado ' +
      'sem depender da página em que ele caiu nem dos filtros do feed.',
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
    summary: 'Anexa um evento ao log da sessão',
    description:
      'Append-only: o `seq` é atribuído pelo servidor e nada no log é atualizado ' +
      'ou removido depois. Não há endpoint de edição, de propósito.',
  })
  @ApiCreatedResponse({ type: SessionEventResponseDto })
  appendEvent(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: AppendSessionEventDto,
  ) {
    return this.appendSessionEvent.execute(projectId, sessionId, dto);
  }
}
