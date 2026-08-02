import { Module } from '@nestjs/common';
import { SessionsUseCasesModule } from '../sessions/sessions-use-cases.module';
import { AgentsUseCasesModule } from '../agents/agents-use-cases.module';
import { EngineHttpClientsModule } from '../../../infrastructure/http-clients/engine-http-clients.module';
import { GitInfrastructureModule } from '../../../infrastructure/git/git-infrastructure.module';
import { FilesystemModule } from '../../../infrastructure/filesystem/filesystem.module';
import { ActivateExecutionUseCase } from './activate-execution.use-case';
import { AcceptParallelizationUseCase } from './accept-parallelization.use-case';
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

const USE_CASES = [
  ActivateExecutionUseCase,
  AcceptParallelizationUseCase,
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
  ],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class ExecutionUseCasesModule {}
