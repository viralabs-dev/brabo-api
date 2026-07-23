import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { RequireRole } from './require-role.decorator';
import { GetProjectUseCase } from '../../../application/use-cases/iam/get-project.use-case';
import { UpdateProjectUseCase } from '../../../application/use-cases/iam/update-project.use-case';
import { DeleteProjectUseCase } from '../../../application/use-cases/iam/delete-project.use-case';
import { AddProjectMemberUseCase } from '../../../application/use-cases/iam/add-project-member.use-case';
import { RemoveProjectMemberUseCase } from '../../../application/use-cases/iam/remove-project-member.use-case';
import { ListProjectMembersUseCase } from '../../../application/use-cases/iam/list-project-members.use-case';
import { GetProjectPermissionsUseCase } from '../../../application/use-cases/iam/get-project-permissions.use-case';
import { SetProjectPermissionsUseCase } from '../../../application/use-cases/iam/set-project-permissions.use-case';
import { UpdateProjectDto } from './dto/update-project.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { SetProjectPermissionsDto } from './dto/set-project-permissions.dto';

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly getProject: GetProjectUseCase,
    private readonly updateProject: UpdateProjectUseCase,
    private readonly deleteProject: DeleteProjectUseCase,
    private readonly addProjectMember: AddProjectMemberUseCase,
    private readonly removeProjectMember: RemoveProjectMemberUseCase,
    private readonly listProjectMembers: ListProjectMembersUseCase,
    private readonly getProjectPermissions: GetProjectPermissionsUseCase,
    private readonly setProjectPermissions: SetProjectPermissionsUseCase,
  ) {}

  @Get(':projectId')
  @RequireRole('viewer')
  get(@Param('projectId') projectId: string) {
    return this.getProject.execute(projectId);
  }

  @Patch(':projectId')
  @RequireRole('maintainer')
  update(@Param('projectId') projectId: string, @Body() dto: UpdateProjectDto) {
    return this.updateProject.execute(projectId, dto);
  }

  @Delete(':projectId')
  @RequireRole('maintainer')
  remove(@Param('projectId') projectId: string) {
    return this.deleteProject.execute(projectId);
  }

  @Post(':projectId/members')
  @RequireRole('maintainer')
  addMember(@Param('projectId') projectId: string, @Body() dto: AddMemberDto) {
    return this.addProjectMember.execute(projectId, dto.userId, dto.role);
  }

  @Get(':projectId/members')
  @RequireRole('viewer')
  listMembers(@Param('projectId') projectId: string) {
    return this.listProjectMembers.execute(projectId);
  }

  @Delete(':projectId/members/:userId')
  @RequireRole('maintainer')
  removeMember(
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
  ) {
    return this.removeProjectMember.execute(projectId, userId);
  }

  @Get(':projectId/permissions')
  @RequireRole('maintainer')
  getPermissions(@Param('projectId') projectId: string) {
    return this.getProjectPermissions.execute(projectId);
  }

  @Put(':projectId/permissions')
  @RequireRole('maintainer')
  setPermissions(
    @Param('projectId') projectId: string,
    @Body() dto: SetProjectPermissionsDto,
  ) {
    return this.setProjectPermissions.execute(projectId, dto);
  }
}
