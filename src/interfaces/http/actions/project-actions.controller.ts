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
@ApiTags('ações')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Papel insuficiente no projeto.' })
@ApiNotFoundResponse({ description: 'Projeto inexistente.' })
@Controller('projects/:projectId/actions')
export class ProjectActionsController {
  constructor(
    private readonly listProjectPendingActions: ListProjectPendingActionsUseCase,
  ) {}

  @Get()
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Lista as ações PENDENTES do projeto inteiro, em qualquer sessão',
    description:
      'Só `status=pending` é suportado hoje (omitir também vale como ' +
      'pending). `actionType` filtra por tipo — ex.: `git_merge`, para a ' +
      'aba PRs achar a proposta de merge de um PR sem saber qual sessão a ' +
      'criou.',
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
