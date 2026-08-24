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

@ApiTags('actions')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Insufficient role on the project.' })
@ApiNotFoundResponse({ description: 'Project not found.' })
@Controller('projects/:projectId/agent-autonomy')
export class AgentAutonomyController {
  constructor(
    private readonly getAgentAutonomy: GetAgentAutonomyUseCase,
    private readonly setAgentAutonomy: SetAgentAutonomyUseCase,
  ) {}

  @Get()
  @RequireRole('maintainer')
  @ApiOperation({
    summary: 'Lists the autonomy granted to each agent',
    description:
      'Only the explicitly recorded rules. An agent with no row here falls ' +
      "back to the project's `permissions.json` default.",
  })
  @ApiOkResponse({ type: [AgentAutonomyRuleResponseDto] })
  list(@Param('projectId') projectId: string) {
    return this.getAgentAutonomy.execute(projectId);
  }

  @Put()
  @RequireRole('maintainer')
  @HttpCode(204)
  @ApiOperation({
    summary: "Sets an agent's autonomy for an action type",
    description:
      'Upsert by (agent, type). It does NOT override `permissions.json`: a ' +
      'pattern already in `deny` stays blocked no matter how much autonomy is ' +
      'granted here. `actionType: "*"` is "auto mode" (RN-153) — autonomy for ' +
      'ANY action type of this agent; a specific rule recorded afterwards still ' +
      'wins over the wildcard for that type.',
  })
  @ApiNoContentResponse({ description: 'Rule recorded. No body.' })
  set(@Param('projectId') projectId: string, @Body() dto: SetAgentAutonomyDto) {
    return this.setAgentAutonomy.execute(
      projectId,
      dto.agentId,
      dto.actionType,
      dto.mode,
    );
  }
}
