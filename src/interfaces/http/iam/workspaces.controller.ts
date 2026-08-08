import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { GetWorkspaceSummaryUseCase } from '../../../application/use-cases/iam/get-workspace-summary.use-case';
import { GetProjectsStatusForWorkspaceUseCase } from '../../../application/use-cases/iam/get-projects-status-for-workspace.use-case';
import { GetProjectsSummaryForWorkspaceUseCase } from '../../../application/use-cases/iam/get-projects-summary-for-workspace.use-case';
import { GetUnreadEventsForWorkspaceUseCase } from '../../../application/use-cases/iam/get-unread-events-for-workspace.use-case';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { UnreadEventsDto } from './dto/unread-events.dto';
import { BEARER } from '../../../infrastructure/openapi/documento';
import {
  ProjectResponseDto,
  WorkspaceComPapelResponseDto,
  WorkspaceMemberResponseDto,
  WorkspaceResponseDto,
  WorkspaceSummaryResponseDto,
  ProjectBlockedStatusResponseDto,
  ProjectCardSummaryResponseDto,
  ProjectUnreadEventsResponseDto,
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
    private readonly getWorkspaceSummary: GetWorkspaceSummaryUseCase,
    private readonly getProjectsStatusForWorkspace: GetProjectsStatusForWorkspaceUseCase,
    private readonly getProjectsSummaryForWorkspace: GetProjectsSummaryForWorkspaceUseCase,
    private readonly getUnreadEventsForWorkspace: GetUnreadEventsForWorkspaceUseCase,
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

  @Get(':workspaceId/summary')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Resumo agregado do workspace',
    description:
      'Contagem de projetos, agentes que gastaram tokens neste mês e o gasto do mês ' +
      '— alimenta a linha de resumo do dashboard de projetos.',
  })
  @ApiOkResponse({ type: WorkspaceSummaryResponseDto })
  getSummary(@Param('workspaceId') workspaceId: string) {
    return this.getWorkspaceSummary.execute(workspaceId);
  }

  @Get(':workspaceId/projects-status')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Contagem de tasks bloqueadas por projeto',
    description:
      'Uma linha por projeto do workspace com task bloqueada — alimenta o dot de ' +
      'status da sidebar do dashboard, numa query só em vez de N chamadas ao backlog.',
  })
  @ApiOkResponse({ type: [ProjectBlockedStatusResponseDto] })
  getProjectsStatus(@Param('workspaceId') workspaceId: string) {
    return this.getProjectsStatusForWorkspace.execute(workspaceId);
  }

  @Get(':workspaceId/projects-summary')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Tudo que os cards do dashboard desenham, numa chamada',
    description:
      'Uma linha por projeto do workspace com provedor de git, status de ' +
      'provisionamento, orçamento, última atividade, histórias aguardando promoção e ' +
      'os fatos que decidem a roster de agentes (RN-090).\n\n' +
      'Mesma ideia de `projects-status`, um andar acima: a grade de cards é uma ' +
      'leitura do WORKSPACE, não N leituras de projeto. O caminho anterior fazia sete ' +
      'consultas em poll por card, e com 23 projetos o dashboard sozinho estourava o ' +
      'rate limit de 300 req/min.',
  })
  @ApiOkResponse({ type: [ProjectCardSummaryResponseDto] })
  getProjectsSummary(@Param('workspaceId') workspaceId: string) {
    return this.getProjectsSummaryForWorkspace.execute(workspaceId);
  }

  @Post(':workspaceId/unread-events')
  // LEITURA, apesar do POST — nada é criado, alterado ou apagado, e `201`
  // mentiria. Ver a justificativa na descrição abaixo.
  @HttpCode(200)
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Os eventos não lidos de vários projetos, numa chamada',
    description:
      'A gaveta do sino, para o workspace inteiro (RN-091). Cada cursor diz até que ' +
      '`seq` aquele projeto já foi lido, e a resposta traz o que veio depois disso na ' +
      'sessão mais recente de cada um.\n\n' +
      '**É POST porque é o único verbo com CORPO, não porque muda estado.** O ' +
      'servidor não sabe onde cada leitor parou: "lido até aqui" é um `seq` por ' +
      'projeto guardado no navegador, e não existe (de propósito) endpoint de marcar ' +
      'como lido. Logo o corte precisa VIAJAR no pedido, e são dezenas de pares — em ' +
      'query string isso vira URL longa, que proxy trunca, e ainda colocaria id de ' +
      'projeto do usuário em log de acesso. A rota é idempotente e sem efeito ' +
      'colateral: responde `200`, nunca `201`.\n\n' +
      'Substitui uma requisição POR PROJETO com a gaveta aberta — 23 projetos ' +
      'custavam 286 req/min contra um limite de 300.',
  })
  @ApiOkResponse({ type: [ProjectUnreadEventsResponseDto] })
  getUnreadEvents(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: UnreadEventsDto,
  ) {
    return this.getUnreadEventsForWorkspace.execute(workspaceId, dto.cursors);
  }
}
