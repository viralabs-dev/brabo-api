import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ResumeAgentTurnUseCase } from '../../../application/use-cases/sessions/resume-agent-turn.use-case';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { RequireRole } from '../iam/require-role.decorator';
import { OkResponseDto } from '../shared/dto/comuns.response.dto';

/**
 * O botão "Retomar" do turno interrompido (AT-582, ADR 0226). `developer` é o
 * mesmo mínimo do "Retomar gate" (RN-724).
 */
@ApiTags('sessions')
@ApiBearerAuth(BEARER)
@Controller('projects/:projectId/sessions/:sessionId/agents/:agent')
export class AgentResumeController {
  constructor(private readonly resumeAgentTurn: ResumeAgentTurnUseCase) {}

  @Post('resume')
  @HttpCode(200)
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Resumes the turn an engine restart interrupted',
    description:
      'Human gesture, with no cap: the automatic resume happens once at boot ' +
      '(ADR 0226) and this is the button for the rest. The reply is the ACCEPT ' +
      '(the turn goes up in the engine); progress arrives on the session channel. ' +
      'Requires `developer`.',
  })
  @ApiOkResponse({ type: OkResponseDto })
  @ApiForbiddenResponse({
    description: 'Role below `developer` on the project.',
  })
  @ApiNotFoundResponse({ description: 'Session does not exist.' })
  @ApiConflictResponse({
    description:
      'Nothing to resume — `reason: turno_nao_interrompido` (the agent has no ' +
      'interrupted turn, or one is already running) or `agente_sem_retomada` ' +
      '(the agent cannot resume).',
  })
  resume(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Param('agent') agent: string,
  ) {
    return this.resumeAgentTurn.execute(projectId, sessionId, agent);
  }
}
