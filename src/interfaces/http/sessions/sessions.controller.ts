import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { RequireRole } from '../iam/require-role.decorator';
import { CreateSessionUseCase } from '../../../application/use-cases/sessions/create-session.use-case';
import { GetSessionUseCase } from '../../../application/use-cases/sessions/get-session.use-case';
import { ListSessionsForProjectUseCase } from '../../../application/use-cases/sessions/list-sessions-for-project.use-case';
import { TransitionSessionUseCase } from '../../../application/use-cases/sessions/transition-session.use-case';
import { AppendSessionEventUseCase } from '../../../application/use-cases/sessions/append-session-event.use-case';
import { ListSessionEventsUseCase } from '../../../application/use-cases/sessions/list-session-events.use-case';
import { GetSessionEventUseCase } from '../../../application/use-cases/sessions/get-session-event.use-case';
import { TransitionSessionDto } from './dto/transition-session.dto';
import { AppendSessionEventDto } from './dto/append-session-event.dto';

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
  create(@Param('projectId') projectId: string, @CurrentUser() user: User) {
    return this.createSession.execute(projectId, user.id);
  }

  @Get()
  @RequireRole('viewer')
  list(@Param('projectId') projectId: string) {
    return this.listSessionsForProject.execute(projectId);
  }

  @Get(':sessionId')
  @RequireRole('viewer')
  get(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.getSession.execute(projectId, sessionId);
  }

  @Post(':sessionId/transition')
  @RequireRole('developer')
  transition(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: TransitionSessionDto,
  ) {
    return this.transitionSession.execute(projectId, sessionId, dto.status);
  }

  @Get(':sessionId/events')
  @RequireRole('viewer')
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
  getEvent(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Param('eventId') eventId: string,
  ) {
    return this.getSessionEvent.execute(projectId, sessionId, eventId);
  }

  @Post(':sessionId/events')
  @RequireRole('developer')
  appendEvent(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: AppendSessionEventDto,
  ) {
    return this.appendSessionEvent.execute(projectId, sessionId, dto);
  }
}
