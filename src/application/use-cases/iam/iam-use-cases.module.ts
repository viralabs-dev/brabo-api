import { Module } from '@nestjs/common';
import { SyncUserUseCase } from './sync-user.use-case';
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
import { ResolveEffectiveRoleUseCase } from './resolve-effective-role.use-case';

const USE_CASES = [
  SyncUserUseCase,
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
  ResolveEffectiveRoleUseCase,
];

@Module({
  providers: USE_CASES,
  exports: USE_CASES,
})
export class IamUseCasesModule {}
