import { Global, Module, OnModuleDestroy } from '@nestjs/common';
import { UnitOfWork } from '../../../application/ports/unit-of-work.port';
import { UserRepository } from '../../../application/ports/user-repository.port';
import { WorkspaceRepository } from '../../../application/ports/workspace-repository.port';
import { ProjectRepository } from '../../../application/ports/project-repository.port';
import { SessionRepository } from '../../../application/ports/session-repository.port';
import { SessionEventRepository } from '../../../application/ports/session-event-repository.port';
import { OutboxRepository } from '../../../application/ports/outbox-repository.port';
import { ModelRepository } from '../../../application/ports/model-repository.port';
import { WorkspaceModelRepository } from '../../../application/ports/workspace-model-repository.port';
import { ModelPriceChangeRepository } from '../../../application/ports/model-price-change-repository.port';
import { ModelBindingRepository } from '../../../application/ports/model-binding-repository.port';
import { UserCredentialRepository } from '../../../application/ports/user-credential-repository.port';
import { TokenUsageRepository } from '../../../application/ports/token-usage-repository.port';
import { BudgetRepository } from '../../../application/ports/budget-repository.port';
import { ProposedActionRepository } from '../../../application/ports/proposed-action-repository.port';
import { AgentAutonomyRepository } from '../../../application/ports/agent-autonomy-repository.port';
import { GitConnectionRepository } from '../../../application/ports/git-connection-repository.port';
import { ProvisionedRepositoryRepository } from '../../../application/ports/provisioned-repository-repository.port';
import { RepoBootstrapRepository } from '../../../application/ports/repo-bootstrap-repository.port';
import { HandoffRepository } from '../../../application/ports/handoff-repository.port';
import { DelegationRepository } from '../../../application/ports/delegation-repository.port';
import { AgentInstructionRepository } from '../../../application/ports/agent-instruction-repository.port';
import {
  EpicRepository,
  StoryRepository,
  TaskRepository,
} from '../../../application/ports/backlog-repository.port';
import { ModuleMapRepository } from '../../../application/ports/module-map-repository.port';
import { ProjectsSummaryRepository } from '../../../application/ports/projects-summary-repository.port';
import { AgentAreaRepository } from '../../../application/ports/agent-area-repository.port';
import { InfraArtifactRepository } from '../../../application/ports/infra-artifact-repository.port';
import { PsychologistAnalysisRepository } from '../../../application/ports/psychologist-analysis-repository.port';
import { PsychologistHypothesisRepository } from '../../../application/ports/psychologist-hypothesis-repository.port';
import { AgentInstructionVersionRepository } from '../../../application/ports/agent-instruction-version-repository.port';
import {
  AnamneseOptOutRepository,
  ProficiencyProfileRepository,
} from '../../../application/ports/proficiency-profile-repository.port';
import {
  AnamneseQueueRepository,
  AnamneseRunRepository,
} from '../../../application/ports/anamnese-repository.port';
import { AuthCredentialRepository } from '../../../application/ports/auth-credential-repository.port';
import { RefreshTokenRepository } from '../../../application/ports/refresh-token-repository.port';
import { AccountTokenRepository } from '../../../application/ports/account-token-repository.port';
import { AuthEventRecorder } from '../../../application/ports/auth-event-recorder.port';
import { LoginThrottle } from '../../../application/ports/login-throttle.port';
import { DrizzleAuthCredentialRepository } from './auth-credential.repository';
import { DrizzleRefreshTokenRepository } from './refresh-token.repository';
import { DrizzleAccountTokenRepository } from './account-token.repository';
import { DrizzleAuthEventRepository } from './auth-event.repository';
import { DrizzleLoginThrottle } from './drizzle-login-throttle';
import { createDrizzleClient, DRIZZLE } from './drizzle-client';
import { DrizzleUnitOfWork } from './drizzle-unit-of-work';
import { DrizzleUserRepository } from './user.repository';
import { DrizzleWorkspaceRepository } from './workspace.repository';
import { DrizzleProjectRepository } from './project.repository';
import { DrizzleProjectsSummaryRepository } from './projects-summary.repository';
import { DrizzleSessionRepository } from './session.repository';
import { DrizzleSessionEventRepository } from './session-event.repository';
import { DrizzleOutboxRepository } from './outbox.repository';
import { DrizzleModelRepository } from './model.repository';
import { DrizzleWorkspaceModelRepository } from './workspace-model.repository';
import { DrizzleModelPriceChangeRepository } from './model-price-change.repository';
import { DrizzleModelBindingRepository } from './model-binding.repository';
import { DrizzleUserCredentialRepository } from './user-credential.repository';
import { DrizzleTokenUsageRepository } from './token-usage.repository';
import { DrizzleBudgetRepository } from './budget.repository';
import { DrizzleProposedActionRepository } from './proposed-action.repository';
import { DrizzleAgentAutonomyRepository } from './agent-autonomy.repository';
import { DrizzleGitConnectionRepository } from './git-connection.repository';
import { DrizzleProvisionedRepositoryRepository } from './provisioned-repository.repository';
import { DrizzleRepoBootstrapRepository } from './repo-bootstrap.repository';
import { DrizzleHandoffRepository } from './handoff.repository';
import { DrizzleDelegationRepository } from './delegation.repository';
import { DrizzleAgentInstructionRepository } from './agent-instruction.repository';
import {
  DrizzleEpicRepository,
  DrizzleStoryRepository,
  DrizzleTaskRepository,
} from './backlog.repository';
import { DrizzleModuleMapRepository } from './module-map.repository';
import { DrizzleAgentAreaRepository } from './agent-area.repository';
import { DrizzleInfraArtifactRepository } from './infra-artifact.repository';
import { DrizzlePsychologistAnalysisRepository } from './psychologist-analysis.repository';
import { DrizzlePsychologistHypothesisRepository } from './psychologist-hypothesis.repository';
import { DrizzleAgentInstructionVersionRepository } from './agent-instruction-version.repository';
import {
  DrizzleAnamneseOptOutRepository,
  DrizzleProficiencyProfileRepository,
} from './proficiency-profile.repository';
import {
  DrizzleAnamneseQueueRepository,
  DrizzleAnamneseRunRepository,
} from './anamnese.repository';

const { db, pool } = createDrizzleClient();

@Global()
@Module({
  providers: [
    { provide: DRIZZLE, useValue: db },
    { provide: 'PG_POOL', useValue: pool },
    { provide: UnitOfWork, useClass: DrizzleUnitOfWork },
    { provide: UserRepository, useClass: DrizzleUserRepository },
    // --- Auth first-party (Fase 7a) ---
    {
      provide: AuthCredentialRepository,
      useClass: DrizzleAuthCredentialRepository,
    },
    {
      provide: RefreshTokenRepository,
      useClass: DrizzleRefreshTokenRepository,
    },
    {
      provide: AccountTokenRepository,
      useClass: DrizzleAccountTokenRepository,
    },
    { provide: AuthEventRecorder, useClass: DrizzleAuthEventRepository },
    { provide: LoginThrottle, useClass: DrizzleLoginThrottle },
    { provide: WorkspaceRepository, useClass: DrizzleWorkspaceRepository },
    { provide: ProjectRepository, useClass: DrizzleProjectRepository },
    { provide: SessionRepository, useClass: DrizzleSessionRepository },
    {
      provide: SessionEventRepository,
      useClass: DrizzleSessionEventRepository,
    },
    { provide: OutboxRepository, useClass: DrizzleOutboxRepository },
    { provide: ModelRepository, useClass: DrizzleModelRepository },
    {
      provide: WorkspaceModelRepository,
      useClass: DrizzleWorkspaceModelRepository,
    },
    {
      provide: ModelPriceChangeRepository,
      useClass: DrizzleModelPriceChangeRepository,
    },
    {
      provide: ModelBindingRepository,
      useClass: DrizzleModelBindingRepository,
    },
    {
      provide: UserCredentialRepository,
      useClass: DrizzleUserCredentialRepository,
    },
    { provide: TokenUsageRepository, useClass: DrizzleTokenUsageRepository },
    { provide: BudgetRepository, useClass: DrizzleBudgetRepository },
    {
      provide: ProposedActionRepository,
      useClass: DrizzleProposedActionRepository,
    },
    {
      provide: AgentAutonomyRepository,
      useClass: DrizzleAgentAutonomyRepository,
    },
    {
      provide: GitConnectionRepository,
      useClass: DrizzleGitConnectionRepository,
    },
    {
      provide: ProvisionedRepositoryRepository,
      useClass: DrizzleProvisionedRepositoryRepository,
    },
    {
      provide: RepoBootstrapRepository,
      useClass: DrizzleRepoBootstrapRepository,
    },
    { provide: HandoffRepository, useClass: DrizzleHandoffRepository },
    { provide: DelegationRepository, useClass: DrizzleDelegationRepository },
    {
      provide: AgentInstructionRepository,
      useClass: DrizzleAgentInstructionRepository,
    },
    { provide: EpicRepository, useClass: DrizzleEpicRepository },
    { provide: StoryRepository, useClass: DrizzleStoryRepository },
    { provide: TaskRepository, useClass: DrizzleTaskRepository },
    {
      provide: ProjectsSummaryRepository,
      useClass: DrizzleProjectsSummaryRepository,
    },
    { provide: ModuleMapRepository, useClass: DrizzleModuleMapRepository },
    { provide: AgentAreaRepository, useClass: DrizzleAgentAreaRepository },
    {
      provide: InfraArtifactRepository,
      useClass: DrizzleInfraArtifactRepository,
    },
    {
      provide: PsychologistAnalysisRepository,
      useClass: DrizzlePsychologistAnalysisRepository,
    },
    {
      provide: PsychologistHypothesisRepository,
      useClass: DrizzlePsychologistHypothesisRepository,
    },
    {
      provide: AgentInstructionVersionRepository,
      useClass: DrizzleAgentInstructionVersionRepository,
    },
    {
      provide: ProficiencyProfileRepository,
      useClass: DrizzleProficiencyProfileRepository,
    },
    {
      provide: AnamneseOptOutRepository,
      useClass: DrizzleAnamneseOptOutRepository,
    },
    {
      provide: AnamneseQueueRepository,
      useClass: DrizzleAnamneseQueueRepository,
    },
    { provide: AnamneseRunRepository, useClass: DrizzleAnamneseRunRepository },
  ],
  exports: [
    DRIZZLE,
    UnitOfWork,
    UserRepository,
    AuthCredentialRepository,
    RefreshTokenRepository,
    AccountTokenRepository,
    AuthEventRecorder,
    LoginThrottle,
    WorkspaceRepository,
    ProjectRepository,
    SessionRepository,
    SessionEventRepository,
    OutboxRepository,
    ModelRepository,
    WorkspaceModelRepository,
    ModelPriceChangeRepository,
    ModelBindingRepository,
    UserCredentialRepository,
    TokenUsageRepository,
    BudgetRepository,
    ProposedActionRepository,
    AgentAutonomyRepository,
    GitConnectionRepository,
    ProvisionedRepositoryRepository,
    RepoBootstrapRepository,
    HandoffRepository,
    DelegationRepository,
    AgentInstructionRepository,
    EpicRepository,
    StoryRepository,
    TaskRepository,
    ProjectsSummaryRepository,
    AgentAreaRepository,
    ModuleMapRepository,
    InfraArtifactRepository,
    PsychologistAnalysisRepository,
    PsychologistHypothesisRepository,
    AgentInstructionVersionRepository,
    ProficiencyProfileRepository,
    AnamneseOptOutRepository,
    AnamneseQueueRepository,
    AnamneseRunRepository,
  ],
})
export class DrizzleModule implements OnModuleDestroy {
  async onModuleDestroy() {
    await pool.end();
  }
}
