import { Body, Controller, Get, HttpCode, Param, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequireRole } from '../iam/require-role.decorator';
import { GetAgentAutonomyUseCase } from '../../../application/use-cases/actions/get-agent-autonomy.use-case';
import { SetAgentAutonomyUseCase } from '../../../application/use-cases/actions/set-agent-autonomy.use-case';
import { SetAgentAutonomyDto } from './dto/set-agent-autonomy.dto';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { AgentAutonomyRuleResponseDto } from './dto/actions.response.dto';

@ApiTags('ações')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Papel insuficiente no projeto.' })
@ApiNotFoundResponse({ description: 'Projeto inexistente.' })
@Controller('projects/:projectId/agent-autonomy')
export class AgentAutonomyController {
  constructor(
    private readonly getAgentAutonomy: GetAgentAutonomyUseCase,
    private readonly setAgentAutonomy: SetAgentAutonomyUseCase,
  ) {}

  @Get()
  @RequireRole('maintainer')
  @ApiOperation({
    summary: 'Lista a autonomia concedida a cada agente',
    description:
      'Só as regras explicitamente gravadas. Agente sem linha aqui cai no padrão ' +
      'do `permissions.json` do projeto.',
  })
  @ApiOkResponse({ type: [AgentAutonomyRuleResponseDto] })
  list(@Param('projectId') projectId: string) {
    return this.getAgentAutonomy.execute(projectId);
  }

  @Put()
  @RequireRole('maintainer')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Define a autonomia de um agente para um tipo de ação',
    description:
      'Upsert por (agente, tipo). NÃO sobrepõe o `permissions.json`: um padrão em ' +
      '`deny` continua bloqueado por mais autonomia que se conceda aqui.',
  })
  @ApiNoContentResponse({ description: 'Regra gravada. Sem corpo.' })
  set(@Param('projectId') projectId: string, @Body() dto: SetAgentAutonomyDto) {
    return this.setAgentAutonomy.execute(
      projectId,
      dto.agentId,
      dto.actionType,
      dto.mode,
    );
  }
}
