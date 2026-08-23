import { forwardRef, Module } from '@nestjs/common';
import { ExecutionUseCasesModule } from '../execution/execution-use-cases.module';
import { ProposeActionUseCase } from './propose-action.use-case';
import { ApproveActionUseCase } from './approve-action.use-case';
import { DenyActionUseCase } from './deny-action.use-case';
import { ApproveAlwaysActionUseCase } from './approve-always-action.use-case';
import { ExecuteTerminalActionUseCase } from './execute-terminal-action.use-case';
import { ExecuteAdrPrUseCase } from './execute-adr-pr.use-case';
import { ExecuteInfraPrUseCase } from './execute-infra-pr.use-case';
import { ExecuteInstructionPatchUseCase } from './execute-instruction-patch.use-case';
import { ExecuteGitActionUseCase } from './execute-git-action.use-case';
import { ListProposedActionsUseCase } from './list-proposed-actions.use-case';
import { ListProjectPendingActionsUseCase } from './list-project-pending-actions.use-case';
import { GetAgentAutonomyUseCase } from './get-agent-autonomy.use-case';
import { SetAgentAutonomyUseCase } from './set-agent-autonomy.use-case';
import { IamUseCasesModule } from '../iam/iam-use-cases.module';
import { SessionsUseCasesModule } from '../sessions/sessions-use-cases.module';
import { EngineHttpClientsModule } from '../../../infrastructure/http-clients/engine-http-clients.module';
import { FilesystemModule } from '../../../infrastructure/filesystem/filesystem.module';
import { GitInfrastructureModule } from '../../../infrastructure/git/git-infrastructure.module';
import { LlmInfrastructureModule } from '../../../infrastructure/llm/llm-infrastructure.module';
import { LlmUseCasesModule } from '../llm/llm-use-cases.module';
import { InstructionsUseCasesModule } from '../instructions/instructions-use-cases.module';

const USE_CASES = [
  ProposeActionUseCase,
  ApproveActionUseCase,
  DenyActionUseCase,
  ApproveAlwaysActionUseCase,
  ExecuteTerminalActionUseCase,
  ExecuteAdrPrUseCase,
  ExecuteInfraPrUseCase,
  ExecuteInstructionPatchUseCase,
  ExecuteGitActionUseCase,
  ListProposedActionsUseCase,
  ListProjectPendingActionsUseCase,
  GetAgentAutonomyUseCase,
  SetAgentAutonomyUseCase,
];

@Module({
  imports: [
    IamUseCasesModule,
    SessionsUseCasesModule,
    EngineHttpClientsModule,
    FilesystemModule,
    GitInfrastructureModule,
    LlmInfrastructureModule,
    // Pelo `ResolveCredentialOwnerUseCase` (RN-058): a credencial de git das
    // ações executadas aqui é a do OWNER do workspace, não a de quem decidiu
    // — e reusar o resolvedor é o que impede duas regras de "de quem é a
    // credencial" divergirem. Mesmo motivo do `GitUseCasesModule`.
    LlmUseCasesModule,
    forwardRef(() => InstructionsUseCasesModule),
    // FASE 14d: aprovar `parallelize` sobe o agente, e aprovar
    // `raise_max_parallel` muda o teto. `forwardRef` porque a execução também
    // depende daqui — é ela que cria a proposed_action quando o lead estoura o
    // teto.
    forwardRef(() => ExecutionUseCasesModule),
  ],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class ActionsUseCasesModule {}
