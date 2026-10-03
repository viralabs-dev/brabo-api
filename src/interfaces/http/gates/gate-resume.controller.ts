import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ResumeParkedGateUseCase } from '../../../application/use-cases/gates/resume-parked-gate.use-case';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { RequireRole } from '../iam/require-role.decorator';
import { OkResponseDto } from '../shared/dto/comuns.response.dto';

/**
 * O gesto humano que retoma o ciclo de gate ESTACIONADO (ADR 0207, RN-724).
 * `developer` é o mesmo mínimo de quem decide a PR (aprovar/negar ação).
 */
@ApiTags('gates')
@ApiBearerAuth(BEARER)
@Controller('projects/:projectId/tasks/:taskId/gates/:gate')
export class GateResumeController {
  constructor(private readonly resumeParkedGate: ResumeParkedGateUseCase) {}

  @Post('resume')
  @HttpCode(200)
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Resumes a parked gate cycle',
    description:
      'A gate cycle stalled for more than 2 h is parked instead of restarted ' +
      'on its own (ADR 0207). This is the human gesture that resumes it.',
  })
  @ApiOkResponse({ type: OkResponseDto })
  @ApiForbiddenResponse({
    description: 'Role below `developer` on the project.',
  })
  @ApiConflictResponse({
    description:
      'The cycle is not parked — body with `reason: "gate_nao_estacionado"`.',
  })
  resume(
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Param('gate') gate: string,
  ) {
    return this.resumeParkedGate.execute(projectId, taskId, gate);
  }
}
