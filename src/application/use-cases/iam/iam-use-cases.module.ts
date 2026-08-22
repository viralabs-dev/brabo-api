import { Module } from '@nestjs/common';
import { FilesystemModule } from '../../../infrastructure/filesystem/filesystem.module';
import { SessionsUseCasesModule } from '../sessions/sessions-use-cases.module';
import { CreateWorkspaceUseCase } from './create-workspace.use-case';
import { ListWorkspacesForUserUseCase } from './list-workspaces-for-user.use-case';
import { GetWorkspaceUseCase } from './get-workspace.use-case';
import { UpdateWorkspaceUseCase } from './update-workspace.use-case';
import { DeleteWorkspaceUseCase } from './delete-workspace.use-case';
import { AddWorkspaceMemberUseCase } from './add-workspace-member.use-case';
import { CreateProjectUseCase } from './create-project.use-case';
import { ConfirmProjectWorkspaceUseCase } from './confirm-project-workspace.use-case';
import { GetProjectUseCase } from './get-project.use-case';
import { UpdateProjectUseCase } from './update-project.use-case';
import { DeleteProjectUseCase } from './delete-project.use-case';
import { AddProjectMemberUseCase } from './add-project-member.use-case';
import { RemoveProjectMemberUseCase } from './remove-project-member.use-case';
import { ResolveEffectiveRoleUseCase } from './resolve-effective-role.use-case';
import { GetProjectPermissionsUseCase } from './get-project-permissions.use-case';
import { SetProjectPermissionsUseCase } from './set-project-permissions.use-case';
import { ListProjectsForWorkspaceUseCase } from './list-projects-for-workspace.use-case';
import { ListProjectMembersUseCase } from './list-project-members.use-case';
import { GetWorkspaceSummaryUseCase } from './get-workspace-summary.use-case';
import { GetProjectsStatusForWorkspaceUseCase } from './get-projects-status-for-workspace.use-case';
import { GetProjectsSummaryForWorkspaceUseCase } from './get-projects-summary-for-workspace.use-case';
import { GetUnreadEventsForWorkspaceUseCase } from './get-unread-events-for-workspace.use-case';
import { GetUserPreferencesUseCase } from './get-user-preferences.use-case';
import { UpdateUserPreferencesUseCase } from './update-user-preferences.use-case';
// Provider direto, e não `imports: [AgentsUseCasesModule]`: o seeding só
// depende do repositório de áreas (DrizzleModule é global), e importar o
// módulo de agentes traria sessões e o cliente do engine junto — aresta nova
// entre IAM e agentes por causa de uma classe sem estado.
import { SeedAgentAreasUseCase } from '../agents/seed-agent-areas.use-case';

const USE_CASES = [
  SeedAgentAreasUseCase,
  CreateWorkspaceUseCase,
  ListWorkspacesForUserUseCase,
  GetWorkspaceUseCase,
  UpdateWorkspaceUseCase,
  DeleteWorkspaceUseCase,
  AddWorkspaceMemberUseCase,
  CreateProjectUseCase,
  ConfirmProjectWorkspaceUseCase,
  GetProjectUseCase,
  UpdateProjectUseCase,
  DeleteProjectUseCase,
  AddProjectMemberUseCase,
  RemoveProjectMemberUseCase,
  ResolveEffectiveRoleUseCase,
  GetProjectPermissionsUseCase,
  SetProjectPermissionsUseCase,
  ListProjectsForWorkspaceUseCase,
  ListProjectMembersUseCase,
  GetWorkspaceSummaryUseCase,
  GetProjectsStatusForWorkspaceUseCase,
  GetProjectsSummaryForWorkspaceUseCase,
  GetUnreadEventsForWorkspaceUseCase,
  GetUserPreferencesUseCase,
  UpdateUserPreferencesUseCase,
];

@Module({
  imports: [FilesystemModule, SessionsUseCasesModule],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class IamUseCasesModule {}
