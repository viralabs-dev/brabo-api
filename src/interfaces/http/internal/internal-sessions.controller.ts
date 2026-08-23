import {
  Body,
  Controller,
  Get,
  Logger,
  MessageEvent,
  Param,
  Post,
  Query,
  RequestMethod,
  Sse,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { Observable, from, map } from 'rxjs';
import { EngineServiceGuard } from '../auth/engine-service.guard';
import { ServiceRoute } from '../auth/service-route.decorator';
import { ReportSessionTerminationUseCase } from '../../../application/use-cases/sessions/report-session-termination.use-case';
import { AppendSessionEventUseCase } from '../../../application/use-cases/sessions/append-session-event.use-case';
import { ListSessionEventsUseCase } from '../../../application/use-cases/sessions/list-session-events.use-case';
import { RunLlmTurnUseCase } from '../../../application/use-cases/llm/run-llm-turn.use-case';
import { StreamLlmTurnUseCase } from '../../../application/use-cases/llm/stream-llm-turn.use-case';
import { ProposeActionUseCase } from '../../../application/use-cases/actions/propose-action.use-case';
import { CreateHandoffUseCase } from '../../../application/use-cases/agents/create-handoff.use-case';
import { CreateEpicUseCase } from '../../../application/use-cases/backlog/create-epic.use-case';
import { CreateStoryUseCase } from '../../../application/use-cases/backlog/create-story.use-case';
import { CreateTaskUseCase } from '../../../application/use-cases/backlog/create-task.use-case';
import { CreateModuleMapUseCase } from '../../../application/use-cases/architecture/create-module-map.use-case';
import { AssignStoryModulesUseCase } from '../../../application/use-cases/architecture/assign-story-modules.use-case';
import { CreateC4DiagramUseCase } from '../../../application/use-cases/architecture/create-c4-diagram.use-case';
import { DecidirImagemDoProjetoUseCase } from '../../../application/use-cases/containers/decidir-imagem-do-projeto.use-case';
import { ClaimNextTaskUseCase } from '../../../application/use-cases/execution/claim-next-task.use-case';
import { MarkTaskUseCase } from '../../../application/use-cases/execution/mark-task.use-case';
import { GetDevTaskContextUseCase } from '../../../application/use-cases/execution/get-dev-task-context.use-case';
import { MarkTaskBlockedUseCase } from '../../../application/use-cases/execution/mark-task-blocked.use-case';
import { RecordGateVerdictUseCase } from '../../../application/use-cases/execution/record-gate-verdict.use-case';
import { RecordDelegationUseCase } from '../../../application/use-cases/execution/record-delegation.use-case';
import { OpenGateUseCase } from '../../../application/use-cases/execution/open-gate.use-case';
import { GetInfraContextUseCase } from '../../../application/use-cases/execution/get-infra-context.use-case';
import { RecordInfraGateVerdictUseCase } from '../../../application/use-cases/execution/record-infra-gate-verdict.use-case';
import { GetInfraPrFilesUseCase } from '../../../application/use-cases/execution/get-infra-pr-files.use-case';
import { GetPsychologistContextUseCase } from '../../../application/use-cases/execution/get-psychologist-context.use-case';
import { ProposeHypothesesUseCase } from '../../../application/use-cases/execution/propose-hypotheses.use-case';
import { GetAnamneseContextUseCase } from '../../../application/use-cases/anamnese/get-anamnese-context.use-case';
import { RecordProficiencyUseCase } from '../../../application/use-cases/anamnese/record-proficiency.use-case';
import { ProposeInstructionPatchUseCase } from '../../../application/use-cases/instructions/propose-instruction-patch.use-case';
import { ProposeMaxParallelUseCase } from '../../../application/use-cases/execution/propose-max-parallel.use-case';
import { BlockTaskInternalDto } from './dto/block-task-internal.dto';
import { RecordGateVerdictInternalDto } from './dto/record-gate-verdict-internal.dto';
import { RecordDelegationInternalDto } from './dto/record-delegation-internal.dto';
import { RecordInfraGateVerdictInternalDto } from './dto/record-infra-gate-verdict-internal.dto';
import { ProposeHypothesesInternalDto } from './dto/propose-hypotheses-internal.dto';
import {
  ProposeInstructionPatchInternalDto,
  ProposeMaxParallelInternalDto,
  RecordProficiencyInternalDto,
} from './dto/record-proficiency-internal.dto';
import { OpenGateInternalDto } from './dto/open-gate-internal.dto';
import { ReportSessionTerminationDto } from './dto/report-session-termination.dto';
import { SessionPendingWorkResponseDto } from './dto/session-pending-work.response.dto';
import { GetSessionPendingWorkUseCase } from '../../../application/use-cases/sessions/get-session-pending-work.use-case';
import { AppendSessionEventInternalDto } from './dto/append-session-event-internal.dto';
import { RunLlmTurnDto } from './dto/run-llm-turn.dto';
import { StreamLlmTurnDto } from './dto/stream-llm-turn.dto';
import { CreateActionInternalDto } from './dto/create-action-internal.dto';
import { CreateHandoffInternalDto } from './dto/create-handoff-internal.dto';
import { CreateEpicInternalDto } from './dto/create-epic-internal.dto';
import { CreateStoryInternalDto } from './dto/create-story-internal.dto';
import { CreateTaskInternalDto } from './dto/create-task-internal.dto';
import { CreateModuleMapInternalDto } from './dto/create-module-map-internal.dto';
import { AssignStoryModulesInternalDto } from './dto/assign-story-modules-internal.dto';
import { CreateC4DiagramInternalDto } from './dto/create-c4-diagram-internal.dto';
import { DecideProjectImageInternalDto } from './dto/decide-project-image-internal.dto';
import { ImagemDecididaResponseDto } from '../containers/dto/containers.response.dto';
import { ClaimTaskInternalDto } from './dto/claim-task-internal.dto';
import { MarkTaskInternalDto } from './dto/mark-task-internal.dto';
import { SERVICE_TOKEN } from '../../../infrastructure/openapi/documento';
import {
  PaginaDeEventosResponseDto,
  SessionEventResponseDto,
  SessionResponseDto,
} from '../sessions/dto/sessions.response.dto';
import { ProposedActionResponseDto } from '../actions/dto/actions.response.dto';
import { HandoffResponseDto } from '../agents/dto/agents.response.dto';
import {
  EpicResponseDto,
  ModuleMapResponseDto,
  C4DiagramaGeradoResponseDto,
  StoryResponseDto,
  TaskResponseDto,
} from '../backlog/dto/backlog.response.dto';
import {
  AnamneseContextResponseDto,
  DelegationResponseDto,
  DevTaskContextResponseDto,
  GateAbertoResponseDto,
  GateVerdictResponseDto,
  InfraContextResponseDto,
  InfraGateVerdictResponseDto,
  InfraPrFilesResponseDto,
  LlmTurnResponseDto,
  LlmTurnStreamEventResponseDto,
  ProposeHypothesesResponseDto,
  PsychologistContextResponseDto,
  RecordProficiencyResponseDto,
} from './dto/internal.response.dto';

/**
 * Chamadas internas do engine (Elixir/OTP) — nunca de um usuário humano.
 *
 * `@ServiceRoute()` tira estas rotas do JWT de usuário (não há usuário para
 * autenticar) e do rate limit (o engine chama a api a cada evento de agente).
 * Quem autentica é o `EngineServiceGuard`, com o segredo compartilhado
 * `BRABO_SERVICE_TOKEN`. Não há RBAC de projeto aqui.
 */
@ApiTags('internal')
@ApiSecurity(SERVICE_TOKEN)
@ApiForbiddenResponse({
  description: 'Service token missing or different from the shared one.',
})
@ApiNotFoundResponse({
  description: 'Session, project, or resource not found.',
})
@ApiBadRequestResponse({ description: 'Invalid body.' })
@Controller('internal/sessions')
@ServiceRoute()
@UseGuards(EngineServiceGuard)
export class InternalSessionsController {
  private readonly logger = new Logger(InternalSessionsController.name);

  constructor(
    private readonly reportTermination: ReportSessionTerminationUseCase,
    private readonly getSessionPendingWork: GetSessionPendingWorkUseCase,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
    private readonly listSessionEvents: ListSessionEventsUseCase,
    private readonly runLlmTurn: RunLlmTurnUseCase,
    private readonly streamLlmTurn: StreamLlmTurnUseCase,
    private readonly proposeAction: ProposeActionUseCase,
    private readonly createHandoff: CreateHandoffUseCase,
    private readonly createEpic: CreateEpicUseCase,
    private readonly createStory: CreateStoryUseCase,
    private readonly createTask: CreateTaskUseCase,
    private readonly createModuleMap: CreateModuleMapUseCase,
    private readonly createC4Diagram: CreateC4DiagramUseCase,
    private readonly assignStoryModules: AssignStoryModulesUseCase,
    private readonly decidirImagem: DecidirImagemDoProjetoUseCase,
    private readonly claimNextTask: ClaimNextTaskUseCase,
    private readonly markTask: MarkTaskUseCase,
    private readonly getDevTaskContext: GetDevTaskContextUseCase,
    private readonly markTaskBlocked: MarkTaskBlockedUseCase,
    private readonly recordGateVerdict: RecordGateVerdictUseCase,
    private readonly recordDelegation: RecordDelegationUseCase,
    private readonly openGate: OpenGateUseCase,
    private readonly getInfraContext: GetInfraContextUseCase,
    private readonly recordInfraGateVerdict: RecordInfraGateVerdictUseCase,
    private readonly getInfraPrFiles: GetInfraPrFilesUseCase,
    private readonly getPsychologistContext: GetPsychologistContextUseCase,
    private readonly proposeHypotheses: ProposeHypothesesUseCase,
    private readonly getAnamneseContext: GetAnamneseContextUseCase,
    private readonly recordProficiency: RecordProficiencyUseCase,
    private readonly proposeInstructionPatch: ProposeInstructionPatchUseCase,
    private readonly proposeMaxParallel: ProposeMaxParallelUseCase,
  ) {}

  /**
   * Reportado quando um processo de sessão supervisionado termina
   * (normal defensivo, crash, kill, heartbeat_timeout). Paradas
   * planejadas pela própria api nunca chegam aqui — o engine já sabe
   * delas via outbox, não há o que reportar de volta.
   */
  // O engine pergunta ANTES de encerrar por heartbeat: fechar sessão é sobre o
  // trabalho ter acabado, não sobre quem está olhando. Numa execução real um
  // handoff `offered` ficou preso numa sessão morta por 30s sem aba — épico e
  // quatro histórias prontos, e a cadeia sem como seguir.
  @Get(':sessionId/pending-work')
  @ApiOperation({
    summary: 'Does the session have pending work that blocks closing it?',
    description:
      "Queried by the engine's `SessionServer` on heartbeat timeout. " +
      '`pending: true` makes the timeout get rescheduled instead of closing, and ' +
      "the `motivo` goes into the engine's log — a session that doesn't close " +
      'without saying why is undiagnosable.',
  })
  @ApiOkResponse({ type: SessionPendingWorkResponseDto })
  pendingWork(@Param('sessionId') sessionId: string) {
    return this.getSessionPendingWork.execute(sessionId);
  }

  @Post(':sessionId/termination')
  @ApiOperation({
    summary: 'Reports that the session process terminated in the engine',
    description:
      'Only terminations the api did NOT cause reach here — crash, kill, ' +
      '`heartbeat_timeout`, defensive shutdown. A stop planned by the api itself ' +
      "doesn't go through here: the engine already learned of it via the " +
      'outbox, and reporting it back would be an echo.',
  })
  @ApiCreatedResponse({ type: SessionResponseDto })
  report(
    @Param('sessionId') sessionId: string,
    @Body() dto: ReportSessionTerminationDto,
  ) {
    this.logger.warn(
      `Sessão ${sessionId} terminou no engine (${dto.to}): ${dto.reason ?? '(sem motivo informado)'}`,
    );
    return this.reportTermination.execute(
      dto.projectId,
      sessionId,
      dto.to,
      dto.reason,
    );
  }

  /**
   * Append genérico de evento pelo engine — reaproveita o mesmo use-case/
   * contrato de seq atômico da rota humana. Usado pelos hooks do harness
   * (EventLog) e pelos desfechos narrados dos agentes (ex.:
   * `psychologist.analysis_failed`). As hipóteses em si NÃO passam por
   * aqui: têm rota própria com validação de evidência
   * (`POST :sessionId/hypotheses`).
   */
  @Post(':sessionId/events')
  @ApiOperation({
    summary: "Appends an event to the session's log, on behalf of an agent",
    description:
      'Same use case and same atomic `seq` assignment as the human route. ' +
      "The Psychologist's hypotheses do NOT go through here: they have their " +
      'own route, with evidence validation.',
  })
  @ApiCreatedResponse({ type: SessionEventResponseDto })
  appendEvent(
    @Param('sessionId') sessionId: string,
    @Body() dto: AppendSessionEventInternalDto,
  ) {
    return this.appendSessionEvent.execute(dto.projectId, sessionId, {
      type: dto.type,
      actor: { kind: dto.actorKind, id: dto.actorId },
      payload: dto.payload,
    });
  }

  /**
   * Leitura interna dos eventos da sessão — usada pelo engine só pra
   * REHIDRATAR o histórico de conversa de um agente (o CriativoServer) no
   * restart. A rota humana equivalente é RBAC-guarded; esta é EngineService.
   */
  @Get(':sessionId/events')
  @ApiOperation({
    summary: "Paginates the session's event log for the engine",
    description:
      "Used to REHYDRATE an agent's conversation history after a restart. The " +
      'equivalent human route is protected by RBAC; this one, by the service token.',
  })
  @ApiQuery({ name: 'projectId', required: true })
  @ApiQuery({ name: 'afterSeq', required: false, example: 40 })
  @ApiQuery({ name: 'limit', required: false, example: 200 })
  @ApiOkResponse({ type: PaginaDeEventosResponseDto })
  listEvents(
    @Param('sessionId') sessionId: string,
    @Query('projectId') projectId: string,
    @Query('afterSeq') afterSeq?: string,
    @Query('limit') limit?: string,
  ) {
    return this.listSessionEvents.execute(projectId, sessionId, {
      afterSeq: afterSeq !== undefined ? Number(afterSeq) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  /**
   * Um turno de LLM pro harness do engine (ToolLoop/ContextManager) —
   * metered obrigatório (token_usage), tool-aware, turno-a-turno. Não grava
   * session_events: o engine narra o event log.
   */
  @Post(':sessionId/llm-turn')
  @ApiOperation({
    summary: 'Runs a metered LLM turn, with tool support',
    description:
      'Metering is MANDATORY: every turn records `token_usage`, and that is ' +
      "what makes the budget mean something. Doesn't record any event — the " +
      'engine narrates the event log. A provider failure comes back in `error` ' +
      'with 200, because the accounting in `usage` remains valid: the turn ' +
      'spent even while failing.',
  })
  @ApiCreatedResponse({ type: LlmTurnResponseDto })
  @ApiForbiddenResponse({
    description:
      'Budget exceeded with `policy=block`, or invalid service token.',
  })
  llmTurn(@Param('sessionId') sessionId: string, @Body() dto: RunLlmTurnDto) {
    return this.runLlmTurn.execute({
      projectId: dto.projectId,
      sessionId,
      agentId: dto.agentId,
      messages: dto.messages,
      tools: dto.tools,
    });
  }

  /**
   * Turno de LLM STREAMADO (SSE) pros agentes conversacionais do engine
   * (Criativo) — o engine consome os deltas e os repassa ao web pelo canal
   * Phoenix; o evento `final` carrega a mensagem completa + uso. Metered
   * obrigatório, sem gravar session_events (o engine narra).
   */
  @Sse(':sessionId/llm-turn-stream', { method: RequestMethod.POST })
  @ApiOperation({
    summary: 'Runs an LLM turn with the response streamed',
    description:
      'Same semantics as `llm-turn`, delivered frame by frame. The `done` frame ' +
      'carries the `usage` — without it the turn would have come out with no ' +
      'accounting.',
  })
  @ApiExtraModels(LlmTurnStreamEventResponseDto)
  @ApiResponse({
    status: 200,
    description: 'Stream of frames up to `done` or `error`.',
    content: {
      'text/event-stream': {
        schema: { $ref: getSchemaPath(LlmTurnStreamEventResponseDto) },
      },
    },
  })
  llmTurnStream(
    @Param('sessionId') sessionId: string,
    @Body() dto: StreamLlmTurnDto,
  ): Observable<MessageEvent> {
    return from(
      this.streamLlmTurn.execute({
        projectId: dto.projectId,
        sessionId,
        agentId: dto.agentId,
        messages: dto.messages,
        tools: dto.tools,
      }),
    ).pipe(map((event) => ({ data: event })));
  }

  /**
   * O engine cria um handoff (offered) quando o Criativo emite o
   * product_brief e o oferece ao PO — a api é dona da tabela `handoffs`.
   */
  @Post(':sessionId/handoffs')
  @ApiOperation({
    summary: 'Offers a handoff from one agent to another',
    description:
      'Born as `offered`. Who accepts is a PERSON, via the human route — an ' +
      "agent doesn't activate an agent.",
  })
  @ApiCreatedResponse({ type: HandoffResponseDto })
  handoff(
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateHandoffInternalDto,
  ) {
    return this.createHandoff.execute(dto.projectId, sessionId, {
      fromAgent: dto.fromAgent,
      toAgent: dto.toAgent,
      artifactId: dto.artifactId,
    });
  }

  /**
   * Ferramentas do PO (create_epic/create_story/create_task) — o PO nunca faz
   * SQL/insert direto; toda criação passa por estes use-cases (validação de
   * domínio: business_rule_id existe, prontidão draft→ready).
   */
  @Post(':sessionId/epics')
  @ApiOperation({ summary: 'Creates a backlog epic' })
  @ApiCreatedResponse({ type: EpicResponseDto })
  epic(
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateEpicInternalDto,
  ) {
    return this.createEpic.execute(dto.projectId, sessionId, {
      title: dto.title,
      description: dto.description,
    });
  }

  @Post(':sessionId/stories')
  @ApiOperation({
    summary:
      'Creates a story with functional/non-functional requirements, DoD, DoR, and covered rules',
    description:
      '`businessRuleIds` is what feeds the rule→story coverage. Each id has to ' +
      'reference an `artifact.business_rule` event that EXISTS — validation ' +
      'rejects a made-up id.',
  })
  @ApiCreatedResponse({ type: StoryResponseDto })
  story(
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateStoryInternalDto,
  ) {
    return this.createStory.execute(dto.projectId, sessionId, {
      epicId: dto.epicId,
      title: dto.title,
      description: dto.description,
      rf: dto.rf,
      rnf: dto.rnf,
      dod: dto.dod,
      dor: dto.dor,
      businessRuleIds: dto.businessRuleIds,
    });
  }

  @Post(':sessionId/tasks')
  @ApiOperation({ summary: 'Creates a task inside a story' })
  @ApiCreatedResponse({ type: TaskResponseDto })
  task(
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateTaskInternalDto,
  ) {
    return this.createTask.execute(dto.projectId, sessionId, {
      storyId: dto.storyId,
      title: dto.title,
      description: dto.description,
    });
  }

  /**
   * Ferramentas do Arquiteto: create_module_map (validado contra ciclos +
   * revalida stories) e assign_story_modules (vincula módulos a uma story).
   */
  @Post(':sessionId/module-map')
  @ApiOperation({
    summary: 'Publishes a new version of the module_map',
    description:
      'The history is immutable: each publication is one more version, and the ' +
      'current one is the one with the highest `version`. A dependency CYCLE ' +
      'between modules gets the map REJECTED with 400 — the graph needs to be acyclic.',
  })
  @ApiCreatedResponse({ type: ModuleMapResponseDto })
  @ApiBadRequestResponse({ description: 'Dependency cycle between modules.' })
  moduleMap(
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateModuleMapInternalDto,
  ) {
    return this.createModuleMap.execute(dto.projectId, sessionId, {
      modules: dto.modules,
    });
  }

  /**
   * Ferramenta `create_c4_diagram` do Arquiteto: gera o diagrama C4 (Context
   * + Container, modelo de Simon Brown) a partir do module_map vigente. O
   * Container level é DERIVADO do mapa — o modelo não o redigita; só o nível
   * Context (nome/descrição do sistema e os atores externos) vem do tool
   * call.
   */
  @Post(':sessionId/c4-diagram')
  @ApiOperation({
    summary: 'Generates a new version of the C4 diagram (Context + Container)',
    description:
      'The artifact IS the `artifact.c4_diagram` event: immutable, versioned, ' +
      'and with an author, alongside `artifact.module_map`. Requires a current ' +
      'module_map — without one there is no Container level to draw (400).',
  })
  @ApiCreatedResponse({ type: C4DiagramaGeradoResponseDto })
  @ApiBadRequestResponse({
    description:
      'Missing `system_name`, invalid actor, or no current module_map.',
  })
  c4Diagram(
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateC4DiagramInternalDto,
  ) {
    return this.createC4Diagram.execute(dto.projectId, sessionId, {
      systemName: dto.systemName,
      systemDescription: dto.systemDescription,
      actors: dto.actors,
    });
  }

  /**
   * O Arquiteto decide qual imagem sobe para o projeto (FASE 25a, ADR 0065).
   *
   * Fica aqui, entre as outras ferramentas dele, porque é do mesmo calibre: o
   * artefato do Arquiteto, versionado no event log, que outra parte do produto
   * consome. É esta decisão que abre o portão da RN-105.
   */
  @Post(':sessionId/project-image')
  @ApiOperation({
    summary: "Sets the project's container image",
    description:
      'The artifact IS the `artifact.project_image` event: immutable, ' +
      'versioned, and with an author. Revising means issuing a new version, ' +
      "never overwriting. While there isn't one yet, the project's container " +
      'does not come up and the Code tab responds 409.',
  })
  @ApiCreatedResponse({ type: ImagemDecididaResponseDto })
  @ApiBadRequestResponse({
    description:
      'Image with no explicit tag (or `latest`), `rationale` too short, ' +
      '`network` outside {none, egress}, or a resource above the cap.',
  })
  projectImage(
    @Param('sessionId') sessionId: string,
    @Body() dto: DecideProjectImageInternalDto,
  ) {
    return this.decidirImagem.execute(dto.projectId, sessionId, {
      image: dto.image,
      rationale: dto.rationale,
      network: dto.network,
      resources: dto.resources,
    });
  }

  @Post(':sessionId/story-modules')
  @ApiOperation({
    summary: 'Associates a story with the modules it touches',
    description:
      "This is the cross-validation: a module that doesn't exist in the " +
      'current map becomes an architecture pending item instead of slipping through unnoticed.',
  })
  @ApiCreatedResponse({ type: StoryResponseDto })
  storyModules(
    @Param('sessionId') sessionId: string,
    @Body() dto: AssignStoryModulesInternalDto,
  ) {
    return this.assignStoryModules.execute(dto.projectId, sessionId, {
      storyId: dto.storyId,
      moduleIds: dto.moduleIds,
    });
  }

  /**
   * Ciclo de task dos dev agents (Fase 4a): claim atômico da próxima task
   * pegável do módulo, e atualização de status ao longo do trabalho.
   */
  @Post(':sessionId/tasks/claim')
  @ApiOperation({
    summary: "Atomically claims the module's next claimable task",
    description:
      'ATOMIC by design: with several dev agents on the same module, two ' +
      'concurrent claims cannot return the same task. With no task available, ' +
      'returns empty instead of an error.',
  })
  @ApiCreatedResponse({ type: TaskResponseDto })
  claimTask(
    @Param('sessionId') sessionId: string,
    @Body() dto: ClaimTaskInternalDto,
  ) {
    return this.claimNextTask.execute(
      dto.projectId,
      sessionId,
      dto.module,
      dto.agentId,
    );
  }

  @Post(':sessionId/tasks/:taskId/status')
  @ApiOperation({ summary: "Moves the task's state as work progresses" })
  @ApiCreatedResponse({ type: TaskResponseDto })
  @ApiConflictResponse({
    description: "Invalid transition, or another agent's task.",
  })
  markTaskStatus(
    @Param('sessionId') sessionId: string,
    @Param('taskId') taskId: string,
    @Body() dto: MarkTaskInternalDto,
  ) {
    return this.markTask.execute(
      dto.projectId,
      sessionId,
      taskId,
      dto.status,
      dto.agentId,
    );
  }

  /**
   * Contexto rico da task pro DevAgent (Fase 4a): story completa (RF/RNF/DoD/
   * DoR), regras de negócio resolvidas e ADRs — alimenta as camadas
   * `regras_negocio`/`estado_tarefa` do harness.
   *
   * `module` (opcional) restringe os ADRs ao módulo do dev; ADR sem módulo
   * declarado é transversal e entra sempre. Omitido = acervo inteiro, que é o
   * que os gates QA/SecOps querem ao reusar este contexto.
   */
  @Get(':sessionId/dev-context')
  @ApiOperation({
    summary: 'Assembles the full context of a task for the dev agent',
    description:
      'A single call with everything the prompt needs: the whole story, the ' +
      'resolved business rules, and the applicable ADRs. `module` restricts the ' +
      "ADRs to that dev's module; an ADR with no declared module is CROSS-CUTTING " +
      'and always comes in. Omitting `module` brings the whole collection, which ' +
      'is what the QA and SecOps gates want when reusing this same context.',
  })
  @ApiQuery({ name: 'projectId', required: true })
  @ApiQuery({ name: 'taskId', required: true })
  @ApiQuery({ name: 'module', required: false, example: 'api' })
  @ApiOkResponse({ type: DevTaskContextResponseDto })
  devContext(
    @Query('projectId') projectId: string,
    @Query('taskId') taskId: string,
    @Query('module') module?: string,
  ) {
    return this.getDevTaskContext.execute(projectId, taskId, module);
  }

  /**
   * Contexto inicial do InfraAgent (Fase 4a): module_map vigente + ADRs
   * `infraRelevant` do projeto — mesmo espírito de `dev-context`.
   */
  @Get(':sessionId/infra-context')
  @ApiOperation({
    summary: "Assembles the InfraAgent's initial context",
    description:
      'The current module_map plus the relevant infrastructure ADRs.',
  })
  @ApiQuery({ name: 'projectId', required: true })
  @ApiOkResponse({ type: InfraContextResponseDto })
  infraContext(@Query('projectId') projectId: string) {
    return this.getInfraContext.execute(projectId);
  }

  /**
   * Contexto do Psicólogo (Fase 4b): se a sessão já foi analisada
   * (idempotência), status/motivo de término, regras de negócio do
   * projeto e hipóteses anteriores não descartadas. O log completo de
   * eventos o engine lê direto do Postgres, não passa por aqui.
   */
  @Get(':sessionId/psychologist-context')
  @ApiOperation({
    summary: 'Assembles the context for a Psychologist round',
    description:
      '`alreadyAnalyzed` is what gives the automatic path IDEMPOTENCY: with ' +
      '`true` the worker short-circuits without spending a token. The prior ' +
      "hypotheses come along so the round doesn't repeat itself.",
  })
  @ApiQuery({ name: 'projectId', required: true })
  @ApiOkResponse({ type: PsychologistContextResponseDto })
  psychologistContext(
    @Param('sessionId') sessionId: string,
    @Query('projectId') projectId: string,
  ) {
    return this.getPsychologistContext.execute(projectId, sessionId);
  }

  /**
   * Hipóteses emitidas pelo Psicólogo (Fase 4b) — valida que TODA
   * evidência aponta pra um event id real desta sessão; rejeita o lote
   * inteiro (4xx) se qualquer uma falhar, e a mensagem volta pro modelo
   * como tool-result pra correção (até o teto de max_iterations).
   */
  @Post(':sessionId/hypotheses')
  @ApiOperation({
    summary: 'Records an analysis round and its hypotheses',
    description:
      'Each hypothesis needs to cite events that EXIST in this session — made-up ' +
      'evidence is rejected with 400, and that is what separates a hypothesis ' +
      "from an opinion. The session's previous round becomes superseded.",
  })
  @ApiCreatedResponse({ type: ProposeHypothesesResponseDto })
  @ApiConflictResponse({
    description: 'A current analysis already exists for this session.',
  })
  hypotheses(
    @Param('sessionId') sessionId: string,
    @Body() dto: ProposeHypothesesInternalDto,
  ) {
    return this.proposeHypotheses.execute(dto.projectId, sessionId, {
      tier: dto.tier,
      triggeredBy: dto.triggeredBy,
      eventCount: dto.eventCount,
      cause: dto.cause,
      hypotheses: dto.hypotheses,
    });
  }

  /**
   * Lê de volta title+files da proposed_action `open_infra_pr` já proposta
   * (Fase 4a) — o `InfraGateRunner` usa isso pra rodar hadolint/gitleaks/
   * semgrep sobre os arquivos SEM worktree (a PR de infra não tem um).
   */
  @Get(':sessionId/infra-artifacts/:prActionId/files')
  @ApiOperation({
    summary: 'Returns the files of an infra PR for the gates to read',
    description:
      "The content comes from the `proposed_action`'s own payload: an infra " +
      'artifact never touches a worktree, same as ADRs.',
  })
  @ApiQuery({ name: 'projectId', required: true })
  @ApiOkResponse({ type: InfraPrFilesResponseDto })
  infraPrFiles(
    @Query('projectId') projectId: string,
    @Param('prActionId') prActionId: string,
  ) {
    return this.getInfraPrFiles.execute(projectId, prActionId);
  }

  /**
   * O DevAgent não conseguiu concluir a task (Fase 4a) — devolve com
   * diagnóstico (limite de iterações, orçamento excedido, ou report_blocked).
   */
  @Post(':sessionId/tasks/:taskId/block')
  @ApiOperation({
    summary: 'Marks the task as blocked, with the reason',
    description:
      'There is no automatic unblocking: whoever unblocks it is a person, via ' +
      'the human route. That is what stops an agent from spinning indefinitely.',
  })
  @ApiCreatedResponse({ type: TaskResponseDto })
  blockTask(
    @Param('sessionId') sessionId: string,
    @Param('taskId') taskId: string,
    @Body() dto: BlockTaskInternalDto,
  ) {
    return this.markTaskBlocked.execute(
      dto.projectId,
      sessionId,
      taskId,
      dto.reason,
      dto.diagnosis,
      dto.agentId,
      dto.origin,
    );
  }

  /**
   * Parecer de um gate de PR (QA/SecOps, Fase 4a) — aplica a máquina de
   * estados do gate, comenta a PR, e devolve pro engine a próxima ação
   * (correct/run_secops/done/blocked).
   */
  @Post(':sessionId/gates/verdict')
  @ApiOperation({
    summary: "Records QA's or SecOps's verdict on a task's PR",
    description:
      "The response's `nextAction` is what the engine obeys: `correct` returns " +
      'to dev, `run_secops` advances the gate, `done` releases it to the user, ' +
      'and `blocked` means the correction cap ran out. MERGE is never automatic ' +
      "— `done` only means it's the human's turn.",
  })
  @ApiCreatedResponse({ type: GateVerdictResponseDto })
  gateVerdict(
    @Param('sessionId') sessionId: string,
    @Body() dto: RecordGateVerdictInternalDto,
  ) {
    return this.recordGateVerdict.execute(
      dto.projectId,
      sessionId,
      {
        taskId: dto.taskId,
        gate: dto.gate,
        veredito: dto.veredito,
        resumo: dto.resumo,
        itens: dto.itens,
      },
      dto.maxCorrections,
    );
  }

  /**
   * Desfecho de UMA delegação de área (Fase 8b QA, Fase 8c Infra — ADR 0038)
   * — o lead da área chama isto uma vez por delegado, SEPARADO da chamada
   * que reporta o resultado consolidado pra fora (`gates/verdict` pro QA,
   * `open_infra_pr` pro Infra). Nunca visível como handoff; a api nunca
   * sabe que existe mais de um agente por trás do resultado final da área.
   *
   * Session-scoped, não task-scoped: `taskId` vem no corpo, opcional — QA
   * sempre manda (delegação é sobre uma task), Infra nunca manda (delegação
   * é sobre a sessão, sem task de backlog por trás de uma PR de infra).
   */
  @Post(':sessionId/delegations')
  @ApiOperation({
    summary: 'Records the outcome of an area delegation',
    description:
      '`completed` (with the verdict), `failed` (with the origin), or ' +
      '`dispensed` (with the justification) — the lead never calls this route ' +
      'with a halfway outcome: every delegation is born here already resolved.',
  })
  @ApiCreatedResponse({ type: DelegationResponseDto })
  recordDelegationOutcome(
    @Param('sessionId') sessionId: string,
    @Body() dto: RecordDelegationInternalDto,
  ) {
    return this.recordDelegation.execute(dto.projectId, sessionId, {
      taskId: dto.taskId,
      area: dto.area,
      leadAgent: dto.leadAgent,
      subagent: dto.subagent,
      status: dto.status,
      parecerArtifactId: dto.parecerArtifactId,
      failureOrigin: dto.failureOrigin,
      failureReason: dto.failureReason,
      justification: dto.justification,
    });
  }

  /**
   * Parecer de um gate de PR de infra (QA/SecOps, Fase 4a — InfraAgent) —
   * mesmo espírito de `gates/verdict`, mas chaveado por `prActionId` (id da
   * proposed_action `open_infra_pr`, único id que o engine conhece de
   * volta) em vez de `taskId` — o artefato de infra não tem task por trás.
   */
  @Post(':sessionId/infra-gates/verdict')
  @ApiOperation({
    summary: "Records QA's or SecOps's verdict on an infra PR",
    description: 'Same pipeline and same state machine as dev PRs.',
  })
  @ApiCreatedResponse({ type: InfraGateVerdictResponseDto })
  infraGateVerdict(
    @Param('sessionId') sessionId: string,
    @Body() dto: RecordInfraGateVerdictInternalDto,
  ) {
    return this.recordInfraGateVerdict.execute(
      dto.projectId,
      sessionId,
      {
        prActionId: dto.prActionId,
        gate: dto.gate,
        veredito: dto.veredito,
        resumo: dto.resumo,
        itens: dto.itens,
      },
      dto.maxCorrections,
    );
  }

  /**
   * Abre o fluxo de gates de uma PR (Fase 4a) — chamado logo depois de
   * `pr_open` executar com sucesso; o engine dispara o QAAgent em seguida.
   */
  @Post(':sessionId/tasks/:taskId/gate/open')
  @ApiOperation({
    summary: "Opens the task's gate pipeline, starting with QA",
    description: "Called when the dev agent's PR is ready for review.",
  })
  @ApiCreatedResponse({ type: GateAbertoResponseDto })
  openGateEndpoint(
    @Param('sessionId') sessionId: string,
    @Param('taskId') taskId: string,
    @Body() dto: OpenGateInternalDto,
  ) {
    return this.openGate.execute(dto.projectId, sessionId, taskId, dto.agentId);
  }

  /**
   * Contexto da rodada da Anamnese (Fase 4b): catálogo de competências
   * permitidas, membros elegíveis (já sem quem optou por sair),
   * hipóteses aceitas na fila, perfis atuais e a janela a analisar.
   */
  @Get(':sessionId/anamnese-context')
  @ApiOperation({
    summary: 'Assembles the context for an Anamnesis round',
    description:
      "Everything in one call, mirroring the Psychologist's context. Members " +
      'already come EXCLUDING whoever opted out of being profiled, and the ' +
      "user's decisions within the window come through here because they " +
      "aren't in the event log. The engine reads the events themselves " +
      'straight from Postgres — carrying them over HTTP would be more ' +
      'expensive without being more correct.',
  })
  @ApiQuery({ name: 'projectId', required: true })
  @ApiOkResponse({ type: AnamneseContextResponseDto })
  anamneseContext(@Query('projectId') projectId: string) {
    return this.getAnamneseContext.execute(projectId);
  }

  /**
   * Perfis de proficiência emitidos pela Anamnese (Fase 4b) — valida
   * contra o catálogo permitido (guarda-corpo) e a evidência real antes
   * de gravar; rejeição volta pro modelo como tool-result.
   */
  @Post(':sessionId/proficiency')
  @ApiOperation({
    summary: 'Records the proficiency profiles derived in the round',
    description:
      'A competency outside the catalog is REJECTED, and so is evidence that ' +
      'cites an event from another project — both validations exist because ' +
      'the model gets both things wrong.',
  })
  @ApiCreatedResponse({ type: RecordProficiencyResponseDto })
  proficiency(
    @Param('sessionId') sessionId: string,
    @Body() dto: RecordProficiencyInternalDto,
  ) {
    return this.recordProficiency.execute(dto.projectId, {
      sessionId,
      windowFrom: new Date(dto.windowFrom),
      windowTo: new Date(dto.windowTo),
      eventCount: dto.eventCount,
      profiles: dto.profiles,
    });
  }

  /**
   * Patch de instrução proposto pela Anamnese (Fase 4b): calcula o diff
   * e recusa repropor um patch já negado antes de criar a ação.
   */
  @Post(':sessionId/instruction-patches')
  @ApiOperation({
    summary: "Proposes a patch to an agent's instruction file",
    description:
      "Becomes a `proposed_action`, not a direct write: changing an agent's " +
      'behavior is an external effect and goes through the same approval ' +
      'pipeline as everything else. This closes the hypothesis → patch loop.',
  })
  @ApiCreatedResponse({ type: ProposedActionResponseDto })
  instructionPatch(
    @Param('sessionId') sessionId: string,
    @Body() dto: ProposeInstructionPatchInternalDto,
  ) {
    return this.proposeInstructionPatch.execute(dto.projectId, sessionId, {
      agent: dto.agent,
      proposedContent: dto.proposedContent,
      rationale: dto.rationale,
      hypothesisId: dto.hypothesisId ?? null,
    });
  }

  /**
   * A Anamnese propondo subir o teto de paralelismo (FASE 14d, item 4).
   *
   * Vira `proposed_action` que NUNCA se auto-aprova. Automatizar o ajuste
   * seria o produto elevando o próprio limite de gasto — a Anamnese aponta, e
   * a decisão continua do usuário.
   */
  @Post(':sessionId/max-parallel-proposals')
  @ApiOperation({
    summary: "Proposes raising an area's parallelism cap",
    description:
      'Refuses to propose a cap equal to or lower than the current one: the ' +
      'Anamnesis runs periodically, and would re-propose the same thing every ' +
      'round, filling with noise a queue the user needs to read.',
  })
  @ApiCreatedResponse({ type: ProposedActionResponseDto })
  maxParallelProposal(
    @Param('sessionId') sessionId: string,
    @Body() dto: ProposeMaxParallelInternalDto,
  ) {
    return this.proposeMaxParallel.execute(dto.projectId, sessionId, {
      area: dto.area,
      proposto: dto.proposto,
      rationale: dto.rationale,
    });
  }

  /**
   * Cria uma proposed_action a partir de uma ferramenta do agente
   * (write_file fora da whitelist, terminal) — passa pelo mesmo decide/
   * permissions da rota humana; terminal auto_approved é auto-executado.
   */
  @Post(':sessionId/actions')
  @ApiOperation({
    summary: 'Proposes an action with an external effect on behalf of an agent',
    description:
      'The ONLY door through which an agent touches git, terminal, or spend. ' +
      '`permissions.json` decides at creation, and `deny` beats any autonomy ' +
      'granted to the agent.',
  })
  @ApiCreatedResponse({ type: ProposedActionResponseDto })
  createAction(
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateActionInternalDto,
  ) {
    return this.proposeAction.execute(dto.projectId, sessionId, {
      actionType: dto.actionType,
      actor: dto.actor,
      payload: dto.payload,
    });
  }
}
