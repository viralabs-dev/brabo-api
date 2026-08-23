import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { RequireRole } from '../iam/require-role.decorator';
import { ActivateExecutionUseCase } from '../../../application/use-cases/execution/activate-execution.use-case';
import { GetActiveExecutionSessionUseCase } from '../../../application/use-cases/execution/get-active-execution-session.use-case';
import { RequestParallelizationUseCase } from '../../../application/use-cases/execution/request-parallelization.use-case';
import { UnblockTaskUseCase } from '../../../application/use-cases/execution/unblock-task.use-case';
import { RearmDevAgentUseCase } from '../../../application/use-cases/execution/rearm-dev-agent.use-case';
import { ListAgentAreasUseCase } from '../../../application/use-cases/execution/list-agent-areas.use-case';
import { SetAreaMaxParallelUseCase } from '../../../application/use-cases/execution/set-area-max-parallel.use-case';
import { AcceptParallelizationDto } from './dto/accept-parallelization.dto';
import { ActivateExecutionDto } from './dto/activate-execution.dto';
import { SetMaxParallelDto } from './dto/set-max-parallel.dto';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { OkResponseDto } from '../shared/dto/comuns.response.dto';
import { SessionResponseDto } from '../sessions/dto/sessions.response.dto';
import {
  AreaDeAgentesResponseDto,
  ExecucaoAtivadaResponseDto,
  PedidoDeParalelismoResponseDto,
} from './dto/execution.response.dto';

/**
 * Ações do usuário sobre a fase de execução (Fase 4a). Ativar exige maintainer
 * (as ações git dos devs herdam o papel do ativador na avaliação de IAM).
 */
@ApiTags('execution')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Insufficient role on the project.' })
@ApiNotFoundResponse({ description: 'Project, session, or task not found.' })
@Controller('projects/:projectId')
export class ExecutionController {
  constructor(
    private readonly activateExecution: ActivateExecutionUseCase,
    private readonly getActiveExecutionSession: GetActiveExecutionSessionUseCase,
    private readonly requestParallelization: RequestParallelizationUseCase,
    private readonly unblockTask: UnblockTaskUseCase,
    private readonly rearmDevAgent: RearmDevAgentUseCase,
    private readonly listAgentAreas: ListAgentAreasUseCase,
    private readonly setAreaMaxParallel: SetAreaMaxParallelUseCase,
  ) {}

  @Post('execution/activate')
  @RequireRole('maintainer')
  @ApiOperation({
    summary:
      'Activates the execution phase and starts one dev agent per module',
    description:
      "Requires `maintainer`, not `developer`, because the dev agents' git " +
      'actions inherit the role of WHOEVER ACTIVATED it in the IAM evaluation — ' +
      'activating as developer would leave agents unable to open a PR. Each ' +
      'module in the `module_map` gets an agent in an isolated worktree.',
  })
  @ApiCreatedResponse({ type: ExecucaoAtivadaResponseDto })
  @ApiConflictResponse({
    description: 'No current module_map, or execution already active.',
  })
  activate(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
    @Body() dto: ActivateExecutionDto,
  ) {
    return this.activateExecution.execute(
      projectId,
      user.id,
      dto.taskBudgetMicros,
      dto.maxGateCorrections,
      dto.devAgentImpl,
      dto.terminalAllowPatterns,
      undefined,
      dto.originSessionId,
    );
  }

  @Get('execution/session')
  @RequireRole('viewer')
  @ApiOperation({
    summary: "Returns the project's current execution session, or nothing",
    description:
      'The most recent `active` session that already carries ' +
      '`execution.activated` — the SAME criterion `activate` uses to decide ' +
      'whether to reactivate or create one (RN-139). `null` when no execution ' +
      'is in progress. Exists so the Executors tab stops inferring this session ' +
      "from the project's most recent one, which shifts from session to " +
      'session with no clue at all in the UI.',
  })
  @ApiOkResponse({
    type: SessionResponseDto,
    description: '`null` in the body when there is no active execution.',
  })
  getSession(@Param('projectId') projectId: string) {
    return this.getActiveExecutionSession.execute(projectId);
  }

  @Post('sessions/:sessionId/execution/parallelize')
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Requests one more dev agent for a module',
    description:
      'Goes through the dev area CAP (RN-083): under it, the agent starts right ' +
      'away, in its own worktree; above it, the response is a `proposed_action` ' +
      'of type `parallelize` awaiting your decision, and NOTHING starts until ' +
      'you decide. What the cap is set to is configurable per lead in Settings.',
  })
  @ApiCreatedResponse({ type: PedidoDeParalelismoResponseDto })
  parallelize(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: User,
    @Body() dto: AcceptParallelizationDto,
  ) {
    return this.requestParallelization.execute(
      projectId,
      sessionId,
      dto.module,
      user.id,
    );
  }

  @Get('agent-areas')
  @RequireRole('developer')
  @ApiOperation({
    summary: "The project's agent areas, with each lead's cap",
    description:
      'The project is born with the three areas (RN-094), so the list comes ' +
      'back full even before there is a `module_map`. What activating execution ' +
      'adds are the MEMBERS of the dev area, one per module.',
  })
  @ApiOkResponse({ type: [AreaDeAgentesResponseDto] })
  listAreas(@Param('projectId') projectId: string) {
    return this.listAgentAreas.execute(projectId);
  }

  @Patch('agent-areas/:key/max-parallel')
  @RequireRole('maintainer')
  @ApiOperation({
    summary: "Changes an area's parallelism cap",
    description:
      'Requires `maintainer`, not `developer`, for the same reason as ' +
      'activating execution: raising the cap is deciding how much the product ' +
      'can spend without asking. Applies to the NEXT requests — whatever is ' +
      'already awaiting your decision keeps waiting.',
  })
  @ApiOkResponse({ type: AreaDeAgentesResponseDto })
  @ApiBadRequestResponse({
    description: '`maxParallel` is not an integer >= 1.',
  })
  setMaxParallel(
    @Param('projectId') projectId: string,
    @Param('key') key: string,
    @Body() dto: SetMaxParallelDto,
  ) {
    return this.setAreaMaxParallel.execute(projectId, key, dto.maxParallel);
  }

  @Post('sessions/:sessionId/tasks/:taskId/unblock')
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Unblocks a blocked task',
    description:
      'Resets the gate correction counter and hands the task back to the ' +
      'agent. It is the human escape hatch for the correction cap — there is ' +
      'no automatic unblock.',
  })
  @ApiCreatedResponse({ type: OkResponseDto })
  unblock(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Param('taskId') taskId: string,
    @CurrentUser() user: User,
  ) {
    return this.unblockTask.execute(projectId, sessionId, taskId, user.id);
  }

  @Post('sessions/:sessionId/agents/:agentId/rearm')
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Rearms a dev agent tripped by the circuit breaker',
    description:
      'Resets the consecutive blocked-tasks counter (RN-047) and puts the agent ' +
      'back to trying to claim work. It is the only way out of `idle_tripped` — ' +
      'there is no automatic unblock.',
  })
  @ApiCreatedResponse({ type: OkResponseDto })
  rearm(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Param('agentId') agentId: string,
    @CurrentUser() user: User,
  ) {
    return this.rearmDevAgent.execute(projectId, sessionId, agentId, user.id);
  }
}
