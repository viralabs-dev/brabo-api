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
@ApiTags('ações')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Papel insuficiente no projeto.' })
@ApiNotFoundResponse({ description: 'Projeto, sessão ou ação inexistente.' })
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
    summary: 'Propõe uma ação com efeito externo',
    description:
      'A ação é avaliada contra o `permissions.json` do projeto na criação. O ' +
      '`resolvedPolicy` da resposta diz o que a política decidiu: `auto_approve` ' +
      'já sai executável, `require_approval` espera decisão humana e `deny` nasce ' +
      'recusada. Não existe caminho que execute sem passar por aqui.',
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
    summary: 'Pagina as ações propostas na sessão',
    description: 'Ordenadas por `seq`; use o `nextCursor` como `afterSeq`.',
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
    summary: 'Aprova a ação, uma vez',
    description:
      'Vale só para esta ação. A decisão fica no event log com o id de quem decidiu.',
  })
  @ApiCreatedResponse({ type: ProposedActionResponseDto })
  @ApiConflictResponse({ description: 'A ação já foi decidida ou executada.' })
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
    summary: 'Aprova a ação e grava o padrão no permissions.json',
    description:
      'Além de liberar esta ação, acrescenta o padrão correspondente ao `allow` do ' +
      'projeto — as próximas iguais saem `auto_approved` sem perguntar. Um padrão ' +
      'que já esteja em `deny` continua bloqueado.',
  })
  @ApiCreatedResponse({ type: ProposedActionResponseDto })
  @ApiConflictResponse({ description: 'A ação já foi decidida ou executada.' })
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
    summary: 'Recusa a ação',
    description: 'O motivo, se vier, fica no event log junto com a decisão.',
  })
  @ApiCreatedResponse({ type: ProposedActionResponseDto })
  @ApiConflictResponse({ description: 'A ação já foi decidida ou executada.' })
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
