import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  HttpCode,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequireRole } from './require-role.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { GetProjectUseCase } from '../../../application/use-cases/iam/get-project.use-case';
import { UpdateProjectUseCase } from '../../../application/use-cases/iam/update-project.use-case';
import { ConvertProjectExecutionModeUseCase } from '../../../application/use-cases/iam/convert-project-execution-mode.use-case';
import { SetProjectMirrorPathUseCase } from '../../../application/use-cases/iam/set-project-mirror-path.use-case';
import { DeleteProjectUseCase } from '../../../application/use-cases/iam/delete-project.use-case';
import { AddProjectMemberUseCase } from '../../../application/use-cases/iam/add-project-member.use-case';
import { RemoveProjectMemberUseCase } from '../../../application/use-cases/iam/remove-project-member.use-case';
import { ListProjectMembersUseCase } from '../../../application/use-cases/iam/list-project-members.use-case';
import { GetProjectPermissionsUseCase } from '../../../application/use-cases/iam/get-project-permissions.use-case';
import { SetProjectPermissionsUseCase } from '../../../application/use-cases/iam/set-project-permissions.use-case';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ConvertExecutionModeDto } from './dto/convert-execution-mode.dto';
import { SetMirrorPathDto } from './dto/set-mirror-path.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { SetProjectPermissionsDto } from './dto/set-project-permissions.dto';
import { BEARER } from '../../../infrastructure/openapi/documento';
import {
  ProjectMemberComUsuarioResponseDto,
  ProjectMemberResponseDto,
  ProjectResponseDto,
} from './dto/iam.response.dto';
import { PermissionsFileResponseDto } from '../actions/dto/actions.response.dto';

@ApiTags('projects')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Insufficient role on the project.' })
@ApiNotFoundResponse({
  description: "Project doesn't exist or is invisible to the caller.",
})
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly getProject: GetProjectUseCase,
    private readonly updateProject: UpdateProjectUseCase,
    private readonly convertExecutionMode: ConvertProjectExecutionModeUseCase,
    private readonly setProjectMirrorPath: SetProjectMirrorPathUseCase,
    private readonly deleteProject: DeleteProjectUseCase,
    private readonly addProjectMember: AddProjectMemberUseCase,
    private readonly removeProjectMember: RemoveProjectMemberUseCase,
    private readonly listProjectMembers: ListProjectMembersUseCase,
    private readonly getProjectPermissions: GetProjectPermissionsUseCase,
    private readonly setProjectPermissions: SetProjectPermissionsUseCase,
  ) {}

  @Get(':projectId')
  @RequireRole('viewer')
  @ApiOperation({ summary: 'Returns a project by id' })
  @ApiOkResponse({ type: ProjectResponseDto })
  get(@Param('projectId') projectId: string) {
    return this.getProject.execute(projectId);
  }

  @Patch(':projectId')
  @RequireRole('maintainer')
  @ApiOperation({ summary: "Changes the project's name or slug" })
  @ApiOkResponse({ type: ProjectResponseDto })
  @ApiConflictResponse({
    description: 'A project with this slug already exists in the workspace.',
  })
  update(@Param('projectId') projectId: string, @Body() dto: UpdateProjectDto) {
    return this.updateProject.execute(projectId, dto);
  }

  @Put(':projectId/execution-mode')
  @RequireRole('maintainer')
  @ApiOperation({
    summary: "Converts the project's execution mode",
    description:
      'Migrates `execution_mode`/`workspacePath` for a project that ' +
      'ALREADY exists (RN-447..450, ADR 0111) — dedicated route, separate ' +
      'from PATCH, because it orchestrates more than a column write: it ' +
      'moves permissions.json to the new scope root, retires the ' +
      'container lifecycle row when leaving `container` mode, and refuses ' +
      '(409) while any dev agent of the project is non-idle, since a ' +
      "running agent doesn't re-resolve its worktree location on its own.",
  })
  @ApiOkResponse({ type: ProjectResponseDto })
  @ApiConflictResponse({
    description: 'A dev agent of this project is working or stuck right now.',
  })
  convertExecutionModeRoute(
    @Param('projectId') projectId: string,
    @Body() dto: ConvertExecutionModeDto,
  ) {
    return this.convertExecutionMode.execute(projectId, dto);
  }

  @Put(':projectId/mirror-path')
  @RequireRole('maintainer')
  @ApiOperation({
    summary: "Declares (or clears) the project's mirror destination",
    description:
      'The absolute path, ON THE USER MACHINE, where the local agent copies ' +
      'the work to (RN-515, ADR 0147) — a folder OUTSIDE the mounted base, ' +
      'which is the whole reason the mirror exists. Per project and never ' +
      'global: one global destination would land project B artifacts in ' +
      "project A's folder, and the user would find out from the contents, " +
      'not from an error. `mirrorPath: null` CLEARS it and turns the mirror ' +
      'off — the key is required, omitting it is a 400, because a body that ' +
      'omits the field would be indistinguishable from asking to clear. ' +
      '`null` is the NORMAL state of a project. `maintainer`, the same ' +
      'minimum as `execution-mode` and `projects-base`: this route talks ' +
      "about a path on the operator's own filesystem. It validates ONLY the " +
      'LEXICAL shape and refuses, with 400, a destination inside ' +
      '`workspacePath` or containing it (both directions of the same loop), ' +
      'and any destination at all on a `container` project. It never ' +
      'touches disk: the API cannot see the machine where the destination ' +
      'will live. Writing the mirror is NOT a proposed_action — it is ' +
      'configuration the user declared, not an agent asking to act.',
  })
  @ApiOkResponse({ type: ProjectResponseDto })
  setMirrorPathRoute(
    @Param('projectId') projectId: string,
    @Body() dto: SetMirrorPathDto,
  ) {
    return this.setProjectMirrorPath.execute(projectId, dto);
  }

  @Delete(':projectId')
  @RequireRole('maintainer')
  @ApiOperation({
    summary: 'Removes the project',
    description:
      'Takes its sessions, event log, and proposed actions along with it.',
  })
  @ApiOkResponse({ type: ProjectResponseDto })
  remove(@Param('projectId') projectId: string) {
    return this.deleteProject.execute(projectId);
  }

  @Post(':projectId/members')
  @RequireRole('maintainer')
  @ApiOperation({
    summary: 'Associates a user with the project',
    description:
      'This role OVERRIDES whatever the person has in the workspace, in ' +
      'both directions: associating someone as `viewer` here really does ' +
      'restrict a workspace `developer` on this project. Two movements are ' +
      'refused with 403 and cannot be enabled anywhere: downgrading a ' +
      'workspace `owner`, and downgrading yourself.',
  })
  @ApiCreatedResponse({ type: ProjectMemberResponseDto })
  @ApiForbiddenResponse({
    description:
      'Insufficient role on the project, OR one of the two downgrade caps ' +
      "(the target is a workspace `owner`; the target is the caller and the role is lower than the caller's current one).",
  })
  addMember(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
    @Body() dto: AddMemberDto,
  ) {
    return this.addProjectMember.execute(
      projectId,
      user.id,
      dto.userId,
      dto.role,
    );
  }

  @Get(':projectId/members')
  @RequireRole('viewer')
  @ApiOperation({
    summary: "Lists the project's members",
    description:
      'Only who was associated HERE, with the role of that association — ' +
      'whoever reaches the project through the workspace alone has no row and ' +
      "doesn't show up.",
  })
  @ApiOkResponse({ type: [ProjectMemberComUsuarioResponseDto] })
  listMembers(@Param('projectId') projectId: string) {
    return this.listProjectMembers.execute(projectId);
  }

  @Delete(':projectId/members/:userId')
  @RequireRole('maintainer')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Disassociates a user from the project',
    description:
      'Removes only the PROJECT association. Whoever has a role in the ' +
      'workspace keeps seeing the project through inheritance.',
  })
  @ApiNoContentResponse({ description: 'Association removed. No body.' })
  removeMember(
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
  ) {
    return this.removeProjectMember.execute(projectId, userId);
  }

  @Get(':projectId/permissions')
  @RequireRole('maintainer')
  @ApiOperation({
    summary: "Reads the project's permissions.json",
    description:
      "It's the physical file at the root of the project's workspace, not a database column.",
  })
  @ApiOkResponse({ type: PermissionsFileResponseDto })
  getPermissions(@Param('projectId') projectId: string) {
    return this.getProjectPermissions.execute(projectId);
  }

  @Put(':projectId/permissions')
  @RequireRole('maintainer')
  @ApiOperation({
    summary: "Rewrites the project's permissions.json",
    description:
      'Replaces all three lists at once. `deny` still beats `allow` in ' +
      "evaluation — there's no way to allow something denied through here.",
  })
  @ApiOkResponse({ type: PermissionsFileResponseDto })
  setPermissions(
    @Param('projectId') projectId: string,
    @Body() dto: SetProjectPermissionsDto,
  ) {
    return this.setProjectPermissions.execute(projectId, dto);
  }
}
