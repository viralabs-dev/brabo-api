import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { EngineServiceGuard } from '../auth/engine-service.guard';
import { ServiceRoute } from '../auth/service-route.decorator';
import { runComoEfeitoDeAcao } from '../../../application/efeito-de-acao';
import { RetireBusinessRuleUseCase } from '../../../application/use-cases/backlog/retire-business-rule.use-case';
import { SERVICE_TOKEN } from '../../../infrastructure/openapi/documento';
import {
  RetireBusinessRuleInternalDto,
  RetiredBusinessRuleResponseDto,
} from './dto/retire-business-rule-internal.dto';

/** O agente retira a regra de negócio obsoleta (AT-755, RN-1018, ADR 0262). */
@ApiTags('internal')
@ApiSecurity(SERVICE_TOKEN)
@ApiForbiddenResponse({
  description:
    'Service token missing or different from the shared one; or the role is not `criativo`/`po` (`papel_nao_retira_regra`).',
})
@Controller('internal')
@ServiceRoute()
@UseGuards(EngineServiceGuard)
export class InternalBusinessRulesController {
  constructor(private readonly retire: RetireBusinessRuleUseCase) {}

  @Post('projects/:projectId/business-rules/:ruleId/retire')
  // Records a fact in the log; does not create an addressable resource.
  @HttpCode(200)
  @ApiOperation({
    summary: 'Retires an obsolete business rule (RN-1018)',
    description:
      'Writes `artifact.business_rule_retired`. The rule stays in the log but ' +
      'leaves every reader (list, coverage, duplicate check, dev context). ' +
      'Stories citing it cite `replacedBy` instead; the retirement is refused ' +
      'when a story would be left with no rule. No approval card: the ' +
      'citation (`replacedBy` and/or an answered `questionId`) is the standard.',
  })
  @ApiOkResponse({ type: RetiredBusinessRuleResponseDto })
  @ApiBadRequestResponse({
    description:
      'Named refusal (`reason`): `retirada_sem_citacao` or `substituta_invalida`.',
  })
  @ApiNotFoundResponse({ description: 'Rule not in this project.' })
  @ApiConflictResponse({
    description:
      'Named refusal (`reason`): `regra_ja_retirada`, `pergunta_nao_respondida`, ' +
      '`historia_ficaria_sem_regra` or `historia_com_tarefa_em_execucao`.',
  })
  retireRoute(
    @Param('projectId') projectId: string,
    @Param('ruleId') ruleId: string,
    @Body() dto: RetireBusinessRuleInternalDto,
  ) {
    // Local effect of the agent's action: mark it so the session channel is
    // notified inside `/internal/*` (the web panel updates live).
    return runComoEfeitoDeAcao(() =>
      this.retire.execute(projectId, ruleId, dto),
    );
  }
}
