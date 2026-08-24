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
      'Only `status=pending` is supported today (omitting it also counts as ' +
      'pending). `actionType` filters by type — e.g. `git_merge`, for the PRs ' +
      'tab to find the merge proposal for a PR without knowing which session ' +
      'created it.',
  })
  @ApiQuery({ name: 'status', required: false, example: 'pending' })
  @ApiQuery({ name: 'actionType', required: false, example: 'git_merge' })
  @ApiOkResponse({ type: [ProposedActionResponseDto] })
  list(
    @Param('projectId') projectId: string,
    @Query('status') status?: string,
    @Query('actionType') actionType?: string,
  ) {
    if (status !== undefined && status !== 'pending') {
      throw new BadRequestException('Só "status=pending" é suportado hoje.');
    }
    return this.listProjectPendingActions.execute(projectId, actionType);
  }
}
