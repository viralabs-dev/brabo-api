import { Module } from '@nestjs/common';
import { SessionsUseCasesModule } from '../sessions/sessions-use-cases.module';
import { AgentsUseCasesModule } from '../agents/agents-use-cases.module';
import { EngineHttpClientsModule } from '../../../infrastructure/http-clients/engine-http-clients.module';
import { ActivateExecutionUseCase } from './activate-execution.use-case';
import { AcceptParallelizationUseCase } from './accept-parallelization.use-case';
import { ClaimNextTaskUseCase } from './claim-next-task.use-case';
import { MarkTaskUseCase } from './mark-task.use-case';

const USE_CASES = [
  ActivateExecutionUseCase,
  AcceptParallelizationUseCase,
  ClaimNextTaskUseCase,
  MarkTaskUseCase,
];

@Module({
  imports: [
    SessionsUseCasesModule,
    AgentsUseCasesModule,
    EngineHttpClientsModule,
  ],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class ExecutionUseCasesModule {}
