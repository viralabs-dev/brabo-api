import { Module } from '@nestjs/common';
import { FilesystemModule } from '../../../infrastructure/filesystem/filesystem.module';
import { CreateWorkspaceUseCase } from './create-workspace.use-case';
import { ListWorkspacesForUserUseCase } from './list-workspaces-for-user.use-case';
import { GetWorkspaceUseCase } from './get-workspace.use-case';
import { UpdateWorkspaceUseCase } from './update-workspace.use-case';
import { DeleteWorkspaceUseCase } from './delete-workspace.use-case';
import { AddWorkspaceMemberUseCase } from './add-workspace-member.use-case';
import { CreateProjectUseCase } from './create-project.use-case';
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

const USE_CASES = [
  CreateWorkspaceUseCase,
  ListWorkspacesForUserUseCase,
  GetWorkspaceUseCase,
  UpdateWorkspaceUseCase,
  DeleteWorkspaceUseCase,
  AddWorkspaceMemberUseCase,
  CreateProjectUseCase,
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
];

@Module({
  imports: [FilesystemModule],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class IamUseCasesModule {}
