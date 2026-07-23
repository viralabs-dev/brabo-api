import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { RequireRole } from './require-role.decorator';
import { GetProjectUseCase } from '../../../application/use-cases/iam/get-project.use-case';
import { UpdateProjectUseCase } from '../../../application/use-cases/iam/update-project.use-case';
import { DeleteProjectUseCase } from '../../../application/use-cases/iam/delete-project.use-case';
import { AddProjectMemberUseCase } from '../../../application/use-cases/iam/add-project-member.use-case';
import { UpdateProjectDto } from './dto/update-project.dto';
import { AddMemberDto } from './dto/add-member.dto';

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly getProject: GetProjectUseCase,
    private readonly updateProject: UpdateProjectUseCase,
    private readonly deleteProject: DeleteProjectUseCase,
    private readonly addProjectMember: AddProjectMemberUseCase,
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
}
