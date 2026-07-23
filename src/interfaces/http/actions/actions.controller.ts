import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { RequireRole } from '../iam/require-role.decorator';
import { ProposeActionUseCase } from '../../../application/use-cases/actions/propose-action.use-case';
import { ApproveActionUseCase } from '../../../application/use-cases/actions/approve-action.use-case';
import { DenyActionUseCase } from '../../../application/use-cases/actions/deny-action.use-case';
import { ApproveAlwaysActionUseCase } from '../../../application/use-cases/actions/approve-always-action.use-case';
import { ListProposedActionsUseCase } from '../../../application/use-cases/actions/list-proposed-actions.use-case';
import { ProposeActionDto } from './dto/propose-action.dto';
import { DenyActionDto } from './dto/deny-action.dto';

@Controller('projects/:projectId/sessions/:sessionId/actions')
export class ActionsController {
  constructor(
    private readonly proposeAction: ProposeActionUseCase,
    private readonly approveAction: ApproveActionUseCase,
    private readonly denyAction: DenyActionUseCase,
    private readonly approveAlwaysAction: ApproveAlwaysActionUseCase,
    private readonly listProposedActions: ListProposedActionsUseCase,
  ) {}

  @Post()
  @RequireRole('developer')
  propose(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: ProposeActionDto,
  ) {
    return this.proposeAction.execute(projectId, sessionId, dto);
  }

  @Get()
  @RequireRole('developer')
  list(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Query('afterSeq') afterSeq?: string,
    @Query('limit') limit?: string,
  ) {
    return this.listProposedActions.execute(projectId, sessionId, {
      afterSeq: afterSeq !== undefined ? Number(afterSeq) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  @Post(':actionId/approve')
  @RequireRole('developer')
  approve(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Param('actionId') actionId: string,
    @CurrentUser() user: User,
  ) {
    return this.approveAction.execute(projectId, sessionId, actionId, user.id);
  }

  @Post(':actionId/approve_always')
  @RequireRole('developer')
  approveAlways(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Param('actionId') actionId: string,
    @CurrentUser() user: User,
  ) {
    return this.approveAlwaysAction.execute(
      projectId,
      sessionId,
      actionId,
      user.id,
    );
  }

  @Post(':actionId/deny')
  @RequireRole('developer')
  deny(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Param('actionId') actionId: string,
    @Body() dto: DenyActionDto,
    @CurrentUser() user: User,
  ) {
    return this.denyAction.execute(
      projectId,
      sessionId,
      actionId,
      user.id,
      dto.reason,
    );
  }
}
