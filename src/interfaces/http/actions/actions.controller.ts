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
import { ProposeActionUseCase } from '../../../application/use-cases/actions/propose-action.use-case';
import { ApproveActionUseCase } from '../../../application/use-cases/actions/approve-action.use-case';
import { DenyActionUseCase } from '../../../application/use-cases/actions/deny-action.use-case';
import { ApproveAlwaysActionUseCase } from '../../../application/use-cases/actions/approve-always-action.use-case';
import { ListProposedActionsUseCase } from '../../../application/use-cases/actions/list-proposed-actions.use-case';
import { ProposeActionDto } from './dto/propose-action.dto';
import { DenyActionDto } from './dto/deny-action.dto';
import { BEARER } from '../../../infrastructure/openapi/documento';
import {
  PaginaDeAcoesResponseDto,
  ProposedActionResponseDto,
} from './dto/actions.response.dto';

/**
 * O pipeline de aprovação: toda ação com efeito externo nasce aqui.
 *
 * Nenhum agente executa git, terminal ou gasto direto — a ação vira uma
 * `proposed_action`, o `permissions.json` decide, e o que sobra espera decisão
 * humana. `deny` sempre vence `allow`.
 */
@ApiTags('actions')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Insufficient role on the project.' })
@ApiNotFoundResponse({ description: 'Project, session, or action not found.' })
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
  @ApiOperation({
    summary: 'Proposes an action with external effect',
    description:
      "The action is evaluated against the project's `permissions.json` on " +
      "creation. The response's `resolvedPolicy` says what the policy decided: " +
      '`auto_approve` comes out already executable, `require_approval` waits for ' +
      'a human decision, and `deny` is born rejected. There is no path that ' +
      'executes without going through here.',
  })
  @ApiCreatedResponse({ type: ProposedActionResponseDto })
  propose(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: ProposeActionDto,
  ) {
    return this.proposeAction.execute(projectId, sessionId, dto);
  }

  @Get()
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Paginates the proposed actions in the session',
    description: 'Ordered by `seq`; use `nextCursor` as `afterSeq`.',
  })
  @ApiQuery({ name: 'afterSeq', required: false, example: 6 })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiOkResponse({ type: PaginaDeAcoesResponseDto })
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
  @ApiOperation({
    summary: 'Approves the action, once',
    description:
      'Applies only to this action. The decision stays in the event log with ' +
      'the id of who decided.',
  })
  @ApiCreatedResponse({ type: ProposedActionResponseDto })
  @ApiConflictResponse({
    description: 'The action was already decided or executed.',
  })
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
  @ApiOperation({
    summary: 'Approves the action and records the pattern in permissions.json',
    description:
      'Besides releasing this action, it adds the corresponding pattern to ' +
      "the project's `allow` list — future matching actions come out " +
      '`auto_approved` without asking. A pattern already in `deny` stays blocked.',
  })
  @ApiCreatedResponse({ type: ProposedActionResponseDto })
  @ApiConflictResponse({
    description: 'The action was already decided or executed.',
  })
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
  @ApiOperation({
    summary: 'Denies the action',
    description:
      'The reason, if given, stays in the event log alongside the decision.',
  })
  @ApiCreatedResponse({ type: ProposedActionResponseDto })
  @ApiConflictResponse({
    description: 'The action was already decided or executed.',
  })
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
