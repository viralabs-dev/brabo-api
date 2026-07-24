import { Body, Controller, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { RequireRole } from '../iam/require-role.decorator';
import { ActivateExecutionUseCase } from '../../../application/use-cases/execution/activate-execution.use-case';
import { AcceptParallelizationUseCase } from '../../../application/use-cases/execution/accept-parallelization.use-case';
import { UnblockTaskUseCase } from '../../../application/use-cases/execution/unblock-task.use-case';
import { AcceptParallelizationDto } from './dto/accept-parallelization.dto';
import { ActivateExecutionDto } from './dto/activate-execution.dto';

/**
 * Ações do usuário sobre a fase de execução (Fase 4a). Ativar exige maintainer
 * (as ações git dos devs herdam o papel do ativador na avaliação de IAM).
 */
@Controller('projects/:projectId')
export class ExecutionController {
  constructor(
    private readonly activateExecution: ActivateExecutionUseCase,
    private readonly acceptParallelization: AcceptParallelizationUseCase,
    private readonly unblockTask: UnblockTaskUseCase,
  ) {}

  @Post('execution/activate')
  @RequireRole('maintainer')
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
    );
  }

  @Post('sessions/:sessionId/execution/parallelize')
  @RequireRole('developer')
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
  unblock(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Param('taskId') taskId: string,
    @CurrentUser() user: User,
  ) {
    return this.unblockTask.execute(projectId, sessionId, taskId, user.id);
  }
}
