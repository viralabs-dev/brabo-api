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
import { baseDeProjetos } from '../../../infrastructure/filesystem/project-workspaces-root';
import {
  ProjectResponseDto,
  ProjectsBaseResponseDto,
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
@ApiForbiddenResponse({ description: 'Insufficient role in the workspace.' })
@ApiNotFoundResponse({
  description: "Workspace doesn't exist or is invisible to the caller.",
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
    summary: 'Creates a workspace',
    description:
      "Requires no role: whoever creates it becomes `owner`. It's the only " +
      "entry point for someone who doesn't belong to any workspace yet.",
  })
  @ApiCreatedResponse({ type: WorkspaceResponseDto })
  @ApiConflictResponse({
    description: 'A workspace with this slug already exists.',
  })
  create(@CurrentUser() user: User, @Body() dto: CreateWorkspaceDto) {
    return this.createWorkspace.execute(user.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: "Lists the caller's workspaces",
    description:
      'Already filtered by association — there is no global listing. Each ' +
      "item carries the caller's own role.",
  })
  @ApiOkResponse({ type: [WorkspaceComPapelResponseDto] })
  list(@CurrentUser() user: User) {
    return this.listWorkspacesForUser.execute(user.id);
  }

  @Get(':workspaceId')
  @RequireRole('viewer')
  @ApiOperation({ summary: 'Returns a workspace by id' })
  @ApiOkResponse({ type: WorkspaceResponseDto })
  get(@Param('workspaceId') workspaceId: string) {
    return this.getWorkspace.execute(workspaceId);
  }

  @Patch(':workspaceId')
  @RequireRole('maintainer')
  @ApiOperation({ summary: "Changes the workspace's name or slug" })
  @ApiOkResponse({ type: WorkspaceResponseDto })
  @ApiConflictResponse({
    description: 'A workspace with this slug already exists.',
  })
  update(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    return this.updateWorkspace.execute(workspaceId, dto);
  }

  @Delete(':workspaceId')
  @RequireRole('owner')
  @ApiOperation({
    summary: 'Removes the workspace',
    description:
      'Requires `owner`. Takes its projects, sessions, and their history along with it.',
  })
  @ApiOkResponse({ type: WorkspaceResponseDto })
  remove(@Param('workspaceId') workspaceId: string) {
    return this.deleteWorkspace.execute(workspaceId);
  }

  @Post(':workspaceId/members')
  @RequireRole('owner')
  @ApiOperation({
    summary: 'Associates a user with the workspace',
    description:
      'Only `owner` can touch the member roster. The role here is inherited ' +
      "by ALL of the workspace's projects.",
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
  @ApiOperation({ summary: 'Creates a project inside the workspace' })
  @ApiCreatedResponse({ type: ProjectResponseDto })
  @ApiConflictResponse({
    description: 'A project with this slug already exists in the workspace.',
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
  @ApiOperation({ summary: "Lists the workspace's projects" })
  @ApiOkResponse({ type: [ProjectResponseDto] })
  listProjects(@Param('workspaceId') workspaceId: string) {
    return this.listProjectsForWorkspace.execute(workspaceId);
  }

  /**
   * A base dos projetos montados (ADR 0141, RN-500).
   *
   * `maintainer`, o MESMO mínimo de `POST :workspaceId/projects` logo acima, e
   * pelo mesmo motivo do PR seguinte: quem não pode criar projeto não precisa
   * saber a topologia de arquivos do operador, e é exatamente para decidir o
   * que a criação oferece que este valor existe. Herdar o `viewer` das rotas
   * vizinhas por elas serem vizinhas é o defeito que a RN-102 nomeia — o
   * mínimo é do ENDPOINT, nunca da seção.
   *
   * Sem caso de uso no meio: não há decisão a tomar, nem repositório a
   * consultar, nem regra de domínio a aplicar. `baseDeProjetos()` já é a fonte
   * ÚNICA da leitura (é ela que a validação de criação/conversão vai usar), e
   * um caso de uso que só a repassasse seria uma camada que não decide nada —
   * o mesmo raciocínio pelo qual `git.controller`/`auth.controller` leem
   * `WEB_ORIGIN` direto. `workspaceId` não entra no cálculo de propósito: a
   * base é da INSTALAÇÃO, não do workspace; ele está na rota porque é o que dá
   * escopo ao `RolesGuard`.
   */
  @Get(':workspaceId/projects-base')
  @RequireRole('maintainer')
  @ApiOperation({
    summary: 'The base folder for projects in Mounted mode',
    description:
      'The single folder on the operator machine that the api and engine ' +
      'containers can see, mounted by identity (ADR 0141). `null` — a normal ' +
      'state, never an error — means this installation has no ' +
      '`BRABO_PROJECTS_BASE`, so the project wizard must not offer Mounted ' +
      'mode at all. The same value for every workspace: it is installation ' +
      'configuration, and `workspaceId` only scopes the authorization.',
  })
  @ApiOkResponse({ type: ProjectsBaseResponseDto })
  getProjectsBase(): ProjectsBaseResponseDto {
    return { projectsBase: baseDeProjetos() };
  }

  @Get(':workspaceId/summary')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Aggregated workspace summary',
    description:
      "Project count, agents that spent tokens this month, and this month's " +
      'spend — feeds the summary line of the project dashboard.',
  })
  @ApiOkResponse({ type: WorkspaceSummaryResponseDto })
  getSummary(@Param('workspaceId') workspaceId: string) {
    return this.getWorkspaceSummary.execute(workspaceId);
  }

  @Get(':workspaceId/projects-status')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Count of blocked tasks per project',
    description:
      'One row per workspace project with a blocked task — feeds the ' +
      "dashboard sidebar's status dot with a single query instead of N calls " +
      'to the backlog.',
  })
  @ApiOkResponse({ type: [ProjectBlockedStatusResponseDto] })
  getProjectsStatus(@Param('workspaceId') workspaceId: string) {
    return this.getProjectsStatusForWorkspace.execute(workspaceId);
  }

  @Get(':workspaceId/projects-summary')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Everything the dashboard cards render, in one call',
    description:
      'One row per workspace project with git provider, provisioning ' +
      'status, budget, last activity, stories awaiting promotion, and the ' +
      'facts that decide the agent roster (RN-090).\n\n' +
      'Same idea as `projects-status`, one floor up: the card grid is a ' +
      'WORKSPACE read, not N project reads. The previous path made seven ' +
      'polled queries per card, and with 23 projects the dashboard alone ' +
      'blew through the 300 req/min rate limit.',
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
    summary: 'Unread events across multiple projects, in one call',
    description:
      "The bell's drawer, for the whole workspace (RN-091). Each cursor " +
      'says up to which `seq` that project has already been read, and the ' +
      "response carries what came after that in each one's most recent " +
      'session.\n\n' +
      "**It's POST because it's the only verb with a BODY, not because it " +
      "changes state.** The server doesn't know where each reader stopped: " +
      '"read up to here" is a `seq` per project stored in the browser, and ' +
      'there is (deliberately) no mark-as-read endpoint. So the cutoff needs ' +
      'to TRAVEL in the request, and there are dozens of pairs — in a query ' +
      'string that becomes a long URL, which a proxy truncates, and would ' +
      "also put the user's project ids in access logs. The route is " +
      'idempotent and has no side effect: it responds `200`, never `201`.\n\n' +
      'Replaces one request PER PROJECT with the drawer open — 23 projects ' +
      'cost 286 req/min against a limit of 300.',
  })
  @ApiOkResponse({ type: [ProjectUnreadEventsResponseDto] })
  getUnreadEvents(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: UnreadEventsDto,
  ) {
    return this.getUnreadEventsForWorkspace.execute(workspaceId, dto.cursors);
  }
}
