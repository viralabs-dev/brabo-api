import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { RequireRole } from './require-role.decorator';
import { CreateWorkspaceUseCase } from '../../../application/use-cases/iam/create-workspace.use-case';
import { ListWorkspacesForUserUseCase } from '../../../application/use-cases/iam/list-workspaces-for-user.use-case';
import { GetWorkspaceUseCase } from '../../../application/use-cases/iam/get-workspace.use-case';
import { UpdateWorkspaceUseCase } from '../../../application/use-cases/iam/update-workspace.use-case';
import { DeleteWorkspaceUseCase } from '../../../application/use-cases/iam/delete-workspace.use-case';
import { AddWorkspaceMemberUseCase } from '../../../application/use-cases/iam/add-workspace-member.use-case';
import { CreateProjectUseCase } from '../../../application/use-cases/iam/create-project.use-case';
import { ListProjectsForWorkspaceUseCase } from '../../../application/use-cases/iam/list-projects-for-workspace.use-case';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { CreateProjectDto } from './dto/create-project.dto';

@Controller('workspaces')
export class WorkspacesController {
  constructor(
    private readonly createWorkspace: CreateWorkspaceUseCase,
    private readonly listWorkspacesForUser: ListWorkspacesForUserUseCase,
    private readonly getWorkspace: GetWorkspaceUseCase,
    private readonly updateWorkspace: UpdateWorkspaceUseCase,
    private readonly deleteWorkspace: DeleteWorkspaceUseCase,
    private readonly addWorkspaceMember: AddWorkspaceMemberUseCase,
    private readonly createProject: CreateProjectUseCase,
    private readonly listProjectsForWorkspace: ListProjectsForWorkspaceUseCase,
  ) {}

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateWorkspaceDto) {
    return this.createWorkspace.execute(user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: User) {
    return this.listWorkspacesForUser.execute(user.id);
  }

  @Get(':workspaceId')
  @RequireRole('viewer')
  get(@Param('workspaceId') workspaceId: string) {
    return this.getWorkspace.execute(workspaceId);
  }

  @Patch(':workspaceId')
  @RequireRole('maintainer')
  update(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    return this.updateWorkspace.execute(workspaceId, dto);
  }

  @Delete(':workspaceId')
  @RequireRole('owner')
  remove(@Param('workspaceId') workspaceId: string) {
    return this.deleteWorkspace.execute(workspaceId);
  }

  @Post(':workspaceId/members')
  @RequireRole('owner')
  addMember(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.addWorkspaceMember.execute(workspaceId, dto.userId, dto.role);
  }

  @Post(':workspaceId/projects')
  @RequireRole('maintainer')
  createProjectInWorkspace(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateProjectDto,
  ) {
    return this.createProject.execute(workspaceId, user.id, dto);
  }

  @Get(':workspaceId/projects')
  @RequireRole('viewer')
  listProjects(@Param('workspaceId') workspaceId: string) {
    return this.listProjectsForWorkspace.execute(workspaceId);
  }
}
