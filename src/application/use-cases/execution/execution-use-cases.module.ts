import { Module } from '@nestjs/common';
import { SessionsUseCasesModule } from '../sessions/sessions-use-cases.module';
import { AgentsUseCasesModule } from '../agents/agents-use-cases.module';
import { EngineHttpClientsModule } from '../../../infrastructure/http-clients/engine-http-clients.module';
import { GitInfrastructureModule } from '../../../infrastructure/git/git-infrastructure.module';
import { ActivateExecutionUseCase } from './activate-execution.use-case';
import { AcceptParallelizationUseCase } from './accept-parallelization.use-case';
import { ClaimNextTaskUseCase } from './claim-next-task.use-case';
import { MarkTaskUseCase } from './mark-task.use-case';
import { GetDevTaskContextUseCase } from './get-dev-task-context.use-case';
import { MarkTaskBlockedUseCase } from './mark-task-blocked.use-case';
import { UnblockTaskUseCase } from './unblock-task.use-case';
import { RecordGateVerdictUseCase } from './record-gate-verdict.use-case';
import { OpenGateUseCase } from './open-gate.use-case';

const USE_CASES = [
  ActivateExecutionUseCase,
  AcceptParallelizationUseCase,
  ClaimNextTaskUseCase,
  MarkTaskUseCase,
  GetDevTaskContextUseCase,
  MarkTaskBlockedUseCase,
  UnblockTaskUseCase,
  RecordGateVerdictUseCase,
  OpenGateUseCase,
];

@Module({
  imports: [
    SessionsUseCasesModule,
    AgentsUseCasesModule,
    EngineHttpClientsModule,
    GitInfrastructureModule,
  ],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class ExecutionUseCasesModule {}
