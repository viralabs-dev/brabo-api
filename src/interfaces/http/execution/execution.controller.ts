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
import {
  AreaDeAgentesResponseDto,
  ExecucaoAtivadaResponseDto,
  PedidoDeParalelismoResponseDto,
} from './dto/execution.response.dto';

/**
 * Ações do usuário sobre a fase de execução (Fase 4a). Ativar exige maintainer
 * (as ações git dos devs herdam o papel do ativador na avaliação de IAM).
 */
@ApiTags('execução')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Papel insuficiente no projeto.' })
@ApiNotFoundResponse({ description: 'Projeto, sessão ou tarefa inexistente.' })
@Controller('projects/:projectId')
export class ExecutionController {
  constructor(
    private readonly activateExecution: ActivateExecutionUseCase,
    private readonly requestParallelization: RequestParallelizationUseCase,
    private readonly unblockTask: UnblockTaskUseCase,
    private readonly rearmDevAgent: RearmDevAgentUseCase,
    private readonly listAgentAreas: ListAgentAreasUseCase,
    private readonly setAreaMaxParallel: SetAreaMaxParallelUseCase,
  ) {}

  @Post('execution/activate')
  @RequireRole('maintainer')
  @ApiOperation({
    summary: 'Ativa a fase de execução e sobe um dev agent por módulo',
    description:
      'Exige `maintainer`, e não `developer`, porque as ações de git dos dev agents ' +
      'herdam o papel de QUEM ATIVOU na avaliação de IAM — ativar como developer ' +
      'daria agentes incapazes de abrir PR. Cada módulo do `module_map` ganha um ' +
      'agente em worktree isolado.',
  })
  @ApiCreatedResponse({ type: ExecucaoAtivadaResponseDto })
  @ApiConflictResponse({
    description: 'Sem module_map vigente, ou execução já ativa.',
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
    );
  }

  @Post('sessions/:sessionId/execution/parallelize')
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Pede mais um dev agent para um módulo',
    description:
      'Passa pelo TETO da área de dev (RN-083): dentro dele o agente sobe na ' +
      'hora, em worktree próprio; acima dele a resposta é uma `proposed_action` ' +
      'do tipo `parallelize` aguardando a sua decisão, e NADA sobe até você ' +
      'decidir. O que o teto vale é configurável por lead em Configurações.',
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
    summary: 'As áreas de agente do projeto, com o teto de cada lead',
    description:
      'O projeto nasce com as três áreas (RN-094), então a lista vem cheia ' +
      'mesmo antes de haver `module_map`. O que a ativação de execução ' +
      'acrescenta são os MEMBROS da área de dev, um por módulo.',
  })
  @ApiOkResponse({ type: [AreaDeAgentesResponseDto] })
  listAreas(@Param('projectId') projectId: string) {
    return this.listAgentAreas.execute(projectId);
  }

  @Patch('agent-areas/:key/max-parallel')
  @RequireRole('maintainer')
  @ApiOperation({
    summary: 'Muda o teto de paralelismo de uma área',
    description:
      'Exige `maintainer`, e não `developer`, pelo mesmo motivo de ativar a ' +
      'execução: subir o teto é decidir quanto o produto pode gastar sem ' +
      'perguntar. Vale para os PRÓXIMOS pedidos — o que já está aguardando ' +
      'sua decisão continua aguardando.',
  })
  @ApiOkResponse({ type: AreaDeAgentesResponseDto })
  @ApiBadRequestResponse({ description: '`maxParallel` não é inteiro >= 1.' })
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
    summary: 'Destrava uma tarefa bloqueada',
    description:
      'Zera o contador de correções de gate e devolve a tarefa ao agente. É a saída ' +
      'humana do teto de correções — não existe destrave automático.',
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
    summary: 'Rearma um dev agent travado pelo circuit breaker',
    description:
      'Zera o contador de tasks blocked consecutivas (RN-047) e devolve o agente ' +
      'a tentar reivindicar. É a única saída de `idle_tripped` — não existe ' +
      'destrave automático.',
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
