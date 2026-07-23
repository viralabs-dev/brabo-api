import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { RequireRole } from '../iam/require-role.decorator';
import { CreateSessionUseCase } from '../../../application/use-cases/sessions/create-session.use-case';
import { GetSessionUseCase } from '../../../application/use-cases/sessions/get-session.use-case';
import { TransitionSessionUseCase } from '../../../application/use-cases/sessions/transition-session.use-case';
import { AppendSessionEventUseCase } from '../../../application/use-cases/sessions/append-session-event.use-case';
import { ListSessionEventsUseCase } from '../../../application/use-cases/sessions/list-session-events.use-case';
import { TransitionSessionDto } from './dto/transition-session.dto';
import { AppendSessionEventDto } from './dto/append-session-event.dto';

@Controller('projects/:projectId/sessions')
export class SessionsController {
  constructor(
    private readonly createSession: CreateSessionUseCase,
    private readonly getSession: GetSessionUseCase,
    private readonly transitionSession: TransitionSessionUseCase,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
    private readonly listSessionEvents: ListSessionEventsUseCase,
  ) {}

  @Post()
  @RequireRole('developer')
  create(@Param('projectId') projectId: string, @CurrentUser() user: User) {
    return this.createSession.execute(projectId, user.id);
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
  ) {
    return this.listSessionEvents.execute(projectId, sessionId, {
      afterSeq: afterSeq !== undefined ? Number(afterSeq) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
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
