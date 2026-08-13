import { forwardRef, Module } from '@nestjs/common';
import { SessionsUseCasesModule } from '../sessions/sessions-use-cases.module';
import { AgentsUseCasesModule } from '../agents/agents-use-cases.module';
import { EngineHttpClientsModule } from '../../../infrastructure/http-clients/engine-http-clients.module';
import { GitInfrastructureModule } from '../../../infrastructure/git/git-infrastructure.module';
import { FilesystemModule } from '../../../infrastructure/filesystem/filesystem.module';
import { ActivateExecutionUseCase } from './activate-execution.use-case';
import { GetActiveExecutionSessionUseCase } from './get-active-execution-session.use-case';
import { AcceptParallelizationUseCase } from './accept-parallelization.use-case';
import { RequestParallelizationUseCase } from './request-parallelization.use-case';
import { ListAgentAreasUseCase } from './list-agent-areas.use-case';
import { SetAreaMaxParallelUseCase } from './set-area-max-parallel.use-case';
import { ExecuteParallelizationUseCase } from './execute-parallelization.use-case';
import { ProposeMaxParallelUseCase } from './propose-max-parallel.use-case';
import { ExecuteMaxParallelRaiseUseCase } from './execute-max-parallel-raise.use-case';
import { ActionsUseCasesModule } from '../actions/actions-use-cases.module';
import { ClaimNextTaskUseCase } from './claim-next-task.use-case';
import { MarkTaskUseCase } from './mark-task.use-case';
import { GetDevTaskContextUseCase } from './get-dev-task-context.use-case';
import { MarkTaskBlockedUseCase } from './mark-task-blocked.use-case';
import { UnblockTaskUseCase } from './unblock-task.use-case';
import { RearmDevAgentUseCase } from './rearm-dev-agent.use-case';
import { RecordGateVerdictUseCase } from './record-gate-verdict.use-case';
import { RecordDelegationUseCase } from './record-delegation.use-case';
import { OpenGateUseCase } from './open-gate.use-case';
import { MarkInfraArtifactBlockedUseCase } from './mark-infra-artifact-blocked.use-case';
import { RecordInfraGateVerdictUseCase } from './record-infra-gate-verdict.use-case';
import { GetInfraContextUseCase } from './get-infra-context.use-case';
import { GetInfraPrFilesUseCase } from './get-infra-pr-files.use-case';
import { ListInfraArtifactsUseCase } from './list-infra-artifacts.use-case';
import { GetPsychologistContextUseCase } from './get-psychologist-context.use-case';
import { ProposeHypothesesUseCase } from './propose-hypotheses.use-case';
import { AcceptHypothesisUseCase } from './accept-hypothesis.use-case';
import { DismissHypothesisUseCase } from './dismiss-hypothesis.use-case';
import { ListHypothesesUseCase } from './list-hypotheses.use-case';
import { ReanalyzeSessionUseCase } from './reanalyze-session.use-case';
import { GetPsychologistAnalysisCostUseCase } from './get-psychologist-analysis-cost.use-case';
import { ListPsychologistAnalysesUseCase } from './list-psychologist-analyses.use-case';
import { AnamneseUseCasesModule } from '../anamnese/anamnese-use-cases.module';
// Mesmo provider que o IAM registra na criação do projeto (RN-094): aqui ele
// volta para dizer QUEM são os membros da área de dev, que só a ativação sabe.
import { SeedAgentAreasUseCase } from '../agents/seed-agent-areas.use-case';

const USE_CASES = [
  SeedAgentAreasUseCase,
  ActivateExecutionUseCase,
  GetActiveExecutionSessionUseCase,
  AcceptParallelizationUseCase,
  RequestParallelizationUseCase,
  ListAgentAreasUseCase,
  SetAreaMaxParallelUseCase,
  ExecuteParallelizationUseCase,
  ProposeMaxParallelUseCase,
  ExecuteMaxParallelRaiseUseCase,
  ClaimNextTaskUseCase,
  MarkTaskUseCase,
  GetDevTaskContextUseCase,
  MarkTaskBlockedUseCase,
  UnblockTaskUseCase,
  RearmDevAgentUseCase,
  RecordGateVerdictUseCase,
  RecordDelegationUseCase,
  OpenGateUseCase,
  MarkInfraArtifactBlockedUseCase,
  RecordInfraGateVerdictUseCase,
  GetInfraContextUseCase,
  GetInfraPrFilesUseCase,
  ListInfraArtifactsUseCase,
  GetPsychologistContextUseCase,
  ProposeHypothesesUseCase,
  AcceptHypothesisUseCase,
  DismissHypothesisUseCase,
  ListHypothesesUseCase,
  ReanalyzeSessionUseCase,
  GetPsychologistAnalysisCostUseCase,
  ListPsychologistAnalysesUseCase,
];

@Module({
  imports: [
    SessionsUseCasesModule,
    AgentsUseCasesModule,
    EngineHttpClientsModule,
    GitInfrastructureModule,
    FilesystemModule,
    AnamneseUseCasesModule,
    // FASE 14d: o pedido de paralelismo acima do teto vira proposed_action.
    forwardRef(() => ActionsUseCasesModule),
  ],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class ExecutionUseCasesModule {}
