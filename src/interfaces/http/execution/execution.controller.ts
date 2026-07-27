import { Body, Controller, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { RequireRole } from '../iam/require-role.decorator';
import { ActivateExecutionUseCase } from '../../../application/use-cases/execution/activate-execution.use-case';
import { AcceptParallelizationUseCase } from '../../../application/use-cases/execution/accept-parallelization.use-case';
import { UnblockTaskUseCase } from '../../../application/use-cases/execution/unblock-task.use-case';
import { AcceptParallelizationDto } from './dto/accept-parallelization.dto';
import { ActivateExecutionDto } from './dto/activate-execution.dto';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { OkResponseDto } from '../shared/dto/comuns.response.dto';
import { ExecucaoAtivadaResponseDto } from './dto/execution.response.dto';

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
    private readonly acceptParallelization: AcceptParallelizationUseCase,
    private readonly unblockTask: UnblockTaskUseCase,
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
    summary: 'Aceita paralelizar um módulo com um dev agent dedicado',
    description:
      'Sobe mais um agente, em worktree próprio, para o módulo indicado.',
  })
  @ApiCreatedResponse({ type: OkResponseDto })
  parallelize(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: User,
    @Body() dto: AcceptParallelizationDto,
  ) {
    return this.acceptParallelization.execute(
      projectId,
      sessionId,
      dto.module,
      user.id,
    );
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
}
