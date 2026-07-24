import { Module } from '@nestjs/common';
import { ProposeActionUseCase } from './propose-action.use-case';
import { ApproveActionUseCase } from './approve-action.use-case';
import { DenyActionUseCase } from './deny-action.use-case';
import { ApproveAlwaysActionUseCase } from './approve-always-action.use-case';
import { ExecuteTerminalActionUseCase } from './execute-terminal-action.use-case';
import { ExecuteAdrPrUseCase } from './execute-adr-pr.use-case';
import { ExecuteGitActionUseCase } from './execute-git-action.use-case';
import { ListProposedActionsUseCase } from './list-proposed-actions.use-case';
import { GetAgentAutonomyUseCase } from './get-agent-autonomy.use-case';
import { SetAgentAutonomyUseCase } from './set-agent-autonomy.use-case';
import { IamUseCasesModule } from '../iam/iam-use-cases.module';
import { SessionsUseCasesModule } from '../sessions/sessions-use-cases.module';
import { EngineHttpClientsModule } from '../../../infrastructure/http-clients/engine-http-clients.module';
import { FilesystemModule } from '../../../infrastructure/filesystem/filesystem.module';
import { GitInfrastructureModule } from '../../../infrastructure/git/git-infrastructure.module';
import { LlmInfrastructureModule } from '../../../infrastructure/llm/llm-infrastructure.module';

const USE_CASES = [
  ProposeActionUseCase,
  ApproveActionUseCase,
  DenyActionUseCase,
  ApproveAlwaysActionUseCase,
  ExecuteTerminalActionUseCase,
  ExecuteAdrPrUseCase,
  ExecuteGitActionUseCase,
  ListProposedActionsUseCase,
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
  ],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class ActionsUseCasesModule {}
