import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { RequireRole } from '../iam/require-role.decorator';
import { GetAgentAutonomyUseCase } from '../../../application/use-cases/actions/get-agent-autonomy.use-case';
import { SetAgentAutonomyUseCase } from '../../../application/use-cases/actions/set-agent-autonomy.use-case';
import { SetAgentAutonomyDto } from './dto/set-agent-autonomy.dto';

@Controller('projects/:projectId/agent-autonomy')
export class AgentAutonomyController {
  constructor(
    private readonly getAgentAutonomy: GetAgentAutonomyUseCase,
    private readonly setAgentAutonomy: SetAgentAutonomyUseCase,
  ) {}

  @Get()
  @RequireRole('maintainer')
  list(@Param('projectId') projectId: string) {
    return this.getAgentAutonomy.execute(projectId);
  }

  @Put()
  @RequireRole('maintainer')
  set(@Param('projectId') projectId: string, @Body() dto: SetAgentAutonomyDto) {
    return this.setAgentAutonomy.execute(
      projectId,
      dto.agentId,
      dto.actionType,
      dto.mode,
    );
  }
}
