import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { RequireRole } from '../iam/require-role.decorator';
import { ProposeActionUseCase } from '../../../application/use-cases/actions/propose-action.use-case';
import { ApproveActionUseCase } from '../../../application/use-cases/actions/approve-action.use-case';
import { RejectActionUseCase } from '../../../application/use-cases/actions/reject-action.use-case';
import { ListProposedActionsUseCase } from '../../../application/use-cases/actions/list-proposed-actions.use-case';
import { ProposeActionDto } from './dto/propose-action.dto';
import { RejectActionDto } from './dto/reject-action.dto';

@Controller('projects/:projectId/sessions/:sessionId/actions')
export class ActionsController {
  constructor(
    private readonly proposeAction: ProposeActionUseCase,
    private readonly approveAction: ApproveActionUseCase,
    private readonly rejectAction: RejectActionUseCase,
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

  @Post(':actionId/reject')
  @RequireRole('developer')
  reject(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Param('actionId') actionId: string,
    @Body() dto: RejectActionDto,
    @CurrentUser() user: User,
  ) {
    return this.rejectAction.execute(
      projectId,
      sessionId,
      actionId,
      user.id,
      dto.reason,
    );
  }
}
