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
import { BEARER } from '../../../infrastructure/openapi/documento';
import {
  ProjectMemberComUsuarioResponseDto,
  ProjectMemberResponseDto,
  ProjectResponseDto,
} from './dto/iam.response.dto';
import { PermissionsFileResponseDto } from '../actions/dto/actions.response.dto';

@ApiTags('projetos')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Papel insuficiente no projeto.' })
@ApiNotFoundResponse({
  description: 'Projeto inexistente ou invisível para quem chamou.',
})
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
  @ApiOperation({ summary: 'Devolve um projeto pelo id' })
  @ApiOkResponse({ type: ProjectResponseDto })
  get(@Param('projectId') projectId: string) {
    return this.getProject.execute(projectId);
  }

  @Patch(':projectId')
  @RequireRole('maintainer')
  @ApiOperation({ summary: 'Altera nome ou slug do projeto' })
  @ApiOkResponse({ type: ProjectResponseDto })
  @ApiConflictResponse({
    description: 'Já existe projeto com este slug no workspace.',
  })
  update(@Param('projectId') projectId: string, @Body() dto: UpdateProjectDto) {
    return this.updateProject.execute(projectId, dto);
  }

  @Delete(':projectId')
  @RequireRole('maintainer')
  @ApiOperation({
    summary: 'Remove o projeto',
    description:
      'Leva junto as sessões, o event log e as ações propostas dele.',
  })
  @ApiOkResponse({ type: ProjectResponseDto })
  remove(@Param('projectId') projectId: string) {
    return this.deleteProject.execute(projectId);
  }

  @Post(':projectId/members')
  @RequireRole('maintainer')
  @ApiOperation({
    summary: 'Associa um usuário ao projeto',
    description:
      'O papel EFETIVO é o maior entre este e o que a pessoa já tem no workspace — ' +
      'associar alguém como `viewer` aqui não rebaixa um `owner` do workspace.',
  })
  @ApiCreatedResponse({ type: ProjectMemberResponseDto })
  addMember(@Param('projectId') projectId: string, @Body() dto: AddMemberDto) {
    return this.addProjectMember.execute(projectId, dto.userId, dto.role);
  }

  @Get(':projectId/members')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Lista os membros do projeto com o papel efetivo',
    description:
      'Inclui quem herda acesso do workspace, não só quem foi associado aqui.',
  })
  @ApiOkResponse({ type: [ProjectMemberComUsuarioResponseDto] })
  listMembers(@Param('projectId') projectId: string) {
    return this.listProjectMembers.execute(projectId);
  }

  @Delete(':projectId/members/:userId')
  @RequireRole('maintainer')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Desassocia um usuário do projeto',
    description:
      'Remove só a associação de PROJETO. Quem tem papel no workspace continua ' +
      'enxergando o projeto por herança.',
  })
  @ApiNoContentResponse()
  removeMember(
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
  ) {
    return this.removeProjectMember.execute(projectId, userId);
  }

  @Get(':projectId/permissions')
  @RequireRole('maintainer')
  @ApiOperation({
    summary: 'Lê o permissions.json do projeto',
    description:
      'É o arquivo físico na raiz do workspace do projeto, não uma coluna do banco.',
  })
  @ApiOkResponse({ type: PermissionsFileResponseDto })
  getPermissions(@Param('projectId') projectId: string) {
    return this.getProjectPermissions.execute(projectId);
  }

  @Put(':projectId/permissions')
  @RequireRole('maintainer')
  @ApiOperation({
    summary: 'Reescreve o permissions.json do projeto',
    description:
      'Substitui as três listas de uma vez. `deny` continua vencendo `allow` na ' +
      'avaliação — não há como liberar por aqui algo que esteja negado.',
  })
  @ApiOkResponse({ type: PermissionsFileResponseDto })
  setPermissions(
    @Param('projectId') projectId: string,
    @Body() dto: SetProjectPermissionsDto,
  ) {
    return this.setProjectPermissions.execute(projectId, dto);
  }
}
