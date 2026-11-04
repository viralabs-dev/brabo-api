import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequireRole } from '../iam/require-role.decorator';
import { GetAgentCatalogUseCase } from '../../../application/use-cases/agents/get-agent-catalog.use-case';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { CatalogoDeAgentesResponseDto } from './dto/agent-catalog.response.dto';

@ApiTags('agents')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Insufficient role on the project.' })
@Controller('projects/:projectId')
export class AgentCatalogController {
  constructor(private readonly catalog: GetAgentCatalogUseCase) {}

  @Get('agent-catalog')
  @RequireRole('viewer')
  @ApiOperation({
    summary: "Lists each agent's identity, project instruction and tools",
    description:
      'Read-only (RN-995). Identity and tools come from the engine; the ' +
      'instruction is the current `agent_instructions` row. No composed ' +
      'prompt, no tool schema. Engine down: identity/tools are null with ' +
      '`motivoSemCatalogo`, instructions still come.',
  })
  @ApiOkResponse({ type: CatalogoDeAgentesResponseDto })
  get(@Param('projectId') projectId: string) {
    return this.catalog.execute(projectId);
  }
}
