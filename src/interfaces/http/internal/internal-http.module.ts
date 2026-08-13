import { Module } from '@nestjs/common';
import { SessionsUseCasesModule } from '../../../application/use-cases/sessions/sessions-use-cases.module';
import { LlmUseCasesModule } from '../../../application/use-cases/llm/llm-use-cases.module';
import { ActionsUseCasesModule } from '../../../application/use-cases/actions/actions-use-cases.module';
import { AgentsUseCasesModule } from '../../../application/use-cases/agents/agents-use-cases.module';
import { BacklogUseCasesModule } from '../../../application/use-cases/backlog/backlog-use-cases.module';
import { ContainersUseCasesModule } from '../../../application/use-cases/containers/containers-use-cases.module';
import { ArchitectureUseCasesModule } from '../../../application/use-cases/architecture/architecture-use-cases.module';
import { ExecutionUseCasesModule } from '../../../application/use-cases/execution/execution-use-cases.module';
import { AnamneseUseCasesModule } from '../../../application/use-cases/anamnese/anamnese-use-cases.module';
import { InstructionsUseCasesModule } from '../../../application/use-cases/instructions/instructions-use-cases.module';
import { GitUseCasesModule } from '../../../application/use-cases/git/git-use-cases.module';
import { InternalSessionsController } from './internal-sessions.controller';
import { InternalModelsController } from './internal-models.controller';
import { InternalGatesController } from './internal-gates.controller';
import { InternalProjectsController } from './internal-projects.controller';

@Module({
  imports: [
    SessionsUseCasesModule,
    LlmUseCasesModule,
    ActionsUseCasesModule,
    AgentsUseCasesModule,
    BacklogUseCasesModule,
    ArchitectureUseCasesModule,
    ContainersUseCasesModule,
    ExecutionUseCasesModule,
    AnamneseUseCasesModule,
    InstructionsUseCasesModule,
    GitUseCasesModule,
  ],
  controllers: [
    InternalSessionsController,
    InternalModelsController,
    // Sem provider: o registro é arquivo, e o loader é função pura memoizada.
    InternalGatesController,
    InternalProjectsController,
  ],
})
export class InternalHttpModule {}
