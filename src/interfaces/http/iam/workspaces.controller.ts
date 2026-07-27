import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
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
import { BEARER } from '../../../infrastructure/openapi/documento';
import {
  ProjectResponseDto,
  WorkspaceComPapelResponseDto,
  WorkspaceMemberResponseDto,
  WorkspaceResponseDto,
} from './dto/iam.response.dto';

@ApiTags('workspaces')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Papel insuficiente no workspace.' })
@ApiNotFoundResponse({
  description: 'Workspace inexistente ou invisível para quem chamou.',
})
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
  @ApiOperation({
    summary: 'Cria um workspace',
    description:
      'Não exige papel: quem cria vira `owner`. É o único ponto de entrada de quem ' +
      'ainda não pertence a workspace nenhum.',
  })
  @ApiCreatedResponse({ type: WorkspaceResponseDto })
  @ApiConflictResponse({ description: 'Já existe workspace com este slug.' })
  create(@CurrentUser() user: User, @Body() dto: CreateWorkspaceDto) {
    return this.createWorkspace.execute(user.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Lista os workspaces de quem chamou',
    description:
      'Já filtrada pela associação — não existe listagem global. Cada item traz o ' +
      'papel do próprio chamador.',
  })
  @ApiOkResponse({ type: [WorkspaceComPapelResponseDto] })
  list(@CurrentUser() user: User) {
    return this.listWorkspacesForUser.execute(user.id);
  }

  @Get(':workspaceId')
  @RequireRole('viewer')
  @ApiOperation({ summary: 'Devolve um workspace pelo id' })
  @ApiOkResponse({ type: WorkspaceResponseDto })
  get(@Param('workspaceId') workspaceId: string) {
    return this.getWorkspace.execute(workspaceId);
  }

  @Patch(':workspaceId')
  @RequireRole('maintainer')
  @ApiOperation({ summary: 'Altera nome ou slug do workspace' })
  @ApiOkResponse({ type: WorkspaceResponseDto })
  @ApiConflictResponse({ description: 'Já existe workspace com este slug.' })
  update(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    return this.updateWorkspace.execute(workspaceId, dto);
  }

  @Delete(':workspaceId')
  @RequireRole('owner')
  @ApiOperation({
    summary: 'Remove o workspace',
    description:
      'Exige `owner`. Leva junto projetos, sessões e o histórico deles.',
  })
  @ApiOkResponse({ type: WorkspaceResponseDto })
  remove(@Param('workspaceId') workspaceId: string) {
    return this.deleteWorkspace.execute(workspaceId);
  }

  @Post(':workspaceId/members')
  @RequireRole('owner')
  @ApiOperation({
    summary: 'Associa um usuário ao workspace',
    description:
      'Só `owner` mexe no quadro de membros. O papel aqui é herdado por TODOS os ' +
      'projetos do workspace.',
  })
  @ApiCreatedResponse({ type: WorkspaceMemberResponseDto })
  addMember(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.addWorkspaceMember.execute(workspaceId, dto.userId, dto.role);
  }

  @Post(':workspaceId/projects')
  @RequireRole('maintainer')
  @ApiOperation({ summary: 'Cria um projeto dentro do workspace' })
  @ApiCreatedResponse({ type: ProjectResponseDto })
  @ApiConflictResponse({
    description: 'Já existe projeto com este slug no workspace.',
  })
  createProjectInWorkspace(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateProjectDto,
  ) {
    return this.createProject.execute(workspaceId, user.id, dto);
  }

  @Get(':workspaceId/projects')
  @RequireRole('viewer')
  @ApiOperation({ summary: 'Lista os projetos do workspace' })
  @ApiOkResponse({ type: [ProjectResponseDto] })
  listProjects(@Param('workspaceId') workspaceId: string) {
    return this.listProjectsForWorkspace.execute(workspaceId);
  }
}
