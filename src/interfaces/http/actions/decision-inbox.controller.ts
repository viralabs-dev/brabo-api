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
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { RequireRole } from '../iam/require-role.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { GetDecisionInboxUseCase } from '../../../application/use-cases/actions/get-decision-inbox.use-case';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { DecisionInboxResponseDto } from './dto/decision-inbox.response.dto';

/** A Caixa de decisões (AT-928, ADR 0295): só leitura; decidir segue nos endpoints de hoje. */
@ApiTags('actions')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'No role on the workspace.' })
@Controller('workspaces/:workspaceId/decision-inbox')
export class DecisionInboxController {
  constructor(private readonly inbox: GetDecisionInboxUseCase) {}

  // `viewer` é só a porta do workspace: o papel EFETIVO de cada projeto
  // (RN-471) é aplicado em lote pelo caso de uso, com o papel de decidir de
  // cada fila como mínimo (RN-102).
  @Get()
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'The five decision queues of every project, in one read',
    description:
      'Approvals (all pending actions except `git_merge`), PRs (`git_merge`), ' +
      'story promotions, architecture pendencies and Psychologist hypotheses. ' +
      'Each queue is separate and carries its own real `total`; there is no ' +
      'total at the root (RN-467). A queue holds at most `tetoPorFila` items ' +
      '(oldest first for `pending`, newest first for `decided`) and says ' +
      '`truncada` when it cuts. `status=decided` lists what was decided since ' +
      '`since` (ISO date, default 24 h ago), the mold of RN-1154; ' +
      'architecture has no decided side. A project only contributes to a queue ' +
      "when the caller's effective role there is enough to DECIDE it " +
      '(`developer`; architecture needs `viewer`).',
  })
  @ApiQuery({ name: 'status', required: false, example: 'pending' })
  @ApiQuery({ name: 'since', required: false, example: '2026-11-11T12:00:00Z' })
  @ApiOkResponse({ type: DecisionInboxResponseDto })
  get(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: User,
    @Query('status') status?: string,
    @Query('since') since?: string,
  ) {
    if (status !== undefined && status !== 'pending' && status !== 'decided') {
      throw new BadRequestException('Só "status=pending" e "status=decided".');
    }
    const desde = since ? new Date(since) : undefined;
    if (desde && Number.isNaN(desde.getTime())) {
      throw new BadRequestException('"since" deve ser uma data ISO.');
    }
    return this.inbox.execute(workspaceId, user.id, { status, since: desde });
  }
}
