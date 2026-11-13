import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { RequireRole } from '../iam/require-role.decorator';
import { ListProjectPendingActionsUseCase } from '../../../application/use-cases/actions/list-project-pending-actions.use-case';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { ProposedActionResponseDto } from './dto/actions.response.dto';

/**
 * Ações pendentes do PROJETO inteiro, em qualquer sessão (Onda 2 do
 * programa de abas agrupadas — aba PRs).
 *
 * Ao lado de `ActionsController` (`.../sessions/:sessionId/actions`,
 * escopado por sessão): esta é a consulta PROJECT-WIDE que resolve o bug de
 * visibilidade descrito em `ProjectApprovalsTab.tsx` — a aba PRs usa isto
 * para achar a `proposed_action` correspondente a um PR (ex.: a proposta de
 * `git_merge` do botão "Merge") sem depender de qual sessão a propôs.
 */
@ApiTags('actions')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Insufficient role on the project.' })
@ApiNotFoundResponse({ description: 'Project not found.' })
@Controller('projects/:projectId/actions')
export class ProjectActionsController {
  constructor(
    private readonly listProjectPendingActions: ListProjectPendingActionsUseCase,
  ) {}

  @Get()
  @RequireRole('developer')
  @ApiOperation({
    summary:
      'Lists the PENDING actions of the whole project, across any session',
    description:
      '`status` is `pending` (the default), `failed` or `decided`. `decided` ' +
      'lists what is no longer pending (approved, denied with `rejectionReason`, ' +
      '`auto_approved`, executed, failed) changed since `since` (ISO date, ' +
      'default 24 h ago), newest first, max 100 (RN-1154). `actionType` filters ' +
      'by type — e.g. `git_merge`, for the PRs tab to find the merge proposal ' +
      'for a PR without knowing which session created it. `status=failed` ' +
      'REQUIRES `actionType` and lists the actions whose execution failed — ' +
      'the PRs tab reads the last refused merge of each PR from it (a merge ' +
      'conflict carries `executionResult.conflictingFiles`).',
  })
  @ApiQuery({ name: 'status', required: false, example: 'pending' })
  @ApiQuery({ name: 'actionType', required: false, example: 'git_merge' })
  @ApiQuery({ name: 'since', required: false, example: '2026-11-10T12:00:00Z' })
  @ApiOkResponse({ type: [ProposedActionResponseDto] })
  list(
    @Param('projectId') projectId: string,
    @Query('status') status?: string,
    @Query('actionType') actionType?: string,
    @Query('since') since?: string,
  ) {
    if (
      status !== undefined &&
      status !== 'pending' &&
      status !== 'failed' &&
      status !== 'decided'
    ) {
      throw new BadRequestException(
        'Só "status=pending", "status=failed" e "status=decided" são suportados.',
      );
    }
    const desde = since ? new Date(since) : undefined;
    if (desde && Number.isNaN(desde.getTime())) {
      throw new BadRequestException('"since" deve ser uma data ISO.');
    }
    if (status === 'failed' && !actionType) {
      throw new BadRequestException('"status=failed" exige "actionType".');
    }
    return this.listProjectPendingActions.execute(
      projectId,
      actionType,
      status ?? 'pending',
      desde,
    );
  }
}
