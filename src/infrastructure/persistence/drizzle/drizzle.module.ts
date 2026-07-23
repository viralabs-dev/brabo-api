import { Global, Module, OnModuleDestroy } from '@nestjs/common';
import { UnitOfWork } from '../../../application/ports/unit-of-work.port';
import { UserRepository } from '../../../application/ports/user-repository.port';
import { WorkspaceRepository } from '../../../application/ports/workspace-repository.port';
import { ProjectRepository } from '../../../application/ports/project-repository.port';
import { SessionRepository } from '../../../application/ports/session-repository.port';
import { SessionEventRepository } from '../../../application/ports/session-event-repository.port';
import { OutboxRepository } from '../../../application/ports/outbox-repository.port';
import { ModelRepository } from '../../../application/ports/model-repository.port';
import { ModelBindingRepository } from '../../../application/ports/model-binding-repository.port';
import { UserCredentialRepository } from '../../../application/ports/user-credential-repository.port';
import { TokenUsageRepository } from '../../../application/ports/token-usage-repository.port';
import { BudgetRepository } from '../../../application/ports/budget-repository.port';
import { createDrizzleClient, DRIZZLE } from './drizzle-client';
import { DrizzleUnitOfWork } from './drizzle-unit-of-work';
import { DrizzleUserRepository } from './user.repository';
import { DrizzleWorkspaceRepository } from './workspace.repository';
import { DrizzleProjectRepository } from './project.repository';
import { DrizzleSessionRepository } from './session.repository';
import { DrizzleSessionEventRepository } from './session-event.repository';
import { DrizzleOutboxRepository } from './outbox.repository';
import { DrizzleModelRepository } from './model.repository';
import { DrizzleModelBindingRepository } from './model-binding.repository';
import { DrizzleUserCredentialRepository } from './user-credential.repository';
import { DrizzleTokenUsageRepository } from './token-usage.repository';
import { DrizzleBudgetRepository } from './budget.repository';

const { db, pool } = createDrizzleClient();

@Global()
@Module({
  providers: [
    { provide: DRIZZLE, useValue: db },
    { provide: 'PG_POOL', useValue: pool },
    { provide: UnitOfWork, useClass: DrizzleUnitOfWork },
    { provide: UserRepository, useClass: DrizzleUserRepository },
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
      provide: ModelBindingRepository,
      useClass: DrizzleModelBindingRepository,
    },
    {
      provide: UserCredentialRepository,
      useClass: DrizzleUserCredentialRepository,
    },
    { provide: TokenUsageRepository, useClass: DrizzleTokenUsageRepository },
    { provide: BudgetRepository, useClass: DrizzleBudgetRepository },
  ],
  exports: [
    DRIZZLE,
    UnitOfWork,
    UserRepository,
    WorkspaceRepository,
    ProjectRepository,
    SessionRepository,
    SessionEventRepository,
    OutboxRepository,
    ModelRepository,
    ModelBindingRepository,
    UserCredentialRepository,
    TokenUsageRepository,
    BudgetRepository,
  ],
})
export class DrizzleModule implements OnModuleDestroy {
  async onModuleDestroy() {
    await pool.end();
  }
}
