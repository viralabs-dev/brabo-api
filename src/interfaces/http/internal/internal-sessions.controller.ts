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
import { BlockTaskInternalDto } from './dto/block-task-internal.dto';
import { RecordGateVerdictInternalDto } from './dto/record-gate-verdict-internal.dto';
import { RecordDelegationInternalDto } from './dto/record-delegation-internal.dto';
import { RecordInfraGateVerdictInternalDto } from './dto/record-infra-gate-verdict-internal.dto';
import { ProposeHypothesesInternalDto } from './dto/propose-hypotheses-internal.dto';
import {
  ProposeInstructionPatchInternalDto,
  RecordProficiencyInternalDto,
} from './dto/record-proficiency-internal.dto';
import { OpenGateInternalDto } from './dto/open-gate-internal.dto';
import { ReportSessionTerminationDto } from './dto/report-session-termination.dto';
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
  description: 'Service token ausente ou diferente do compartilhado.',
})
@ApiNotFoundResponse({ description: 'Sessão, projeto ou recurso inexistente.' })
@ApiBadRequestResponse({ description: 'Corpo inválido.' })
@Controller('internal/sessions')
@ServiceRoute()
@UseGuards(EngineServiceGuard)
export class InternalSessionsController {
  private readonly logger = new Logger(InternalSessionsController.name);

  constructor(
    private readonly reportTermination: ReportSessionTerminationUseCase,
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
    private readonly assignStoryModules: AssignStoryModulesUseCase,
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
  ) {}

  /**
   * Reportado quando um processo de sessão supervisionado termina
   * (normal defensivo, crash, kill, heartbeat_timeout). Paradas
   * planejadas pela própria api nunca chegam aqui — o engine já sabe
   * delas via outbox, não há o que reportar de volta.
   */
  @Post(':sessionId/termination')
  @ApiOperation({
    summary: 'Reporta que o processo da sessão terminou no engine',
    description:
      'Só chega aqui o término que a api NÃO provocou — crash, kill, ' +
      '`heartbeat_timeout`, encerramento defensivo. Parada planejada pela própria ' +
      'api não passa por aqui: o engine já soube dela pelo outbox, e reportar de ' +
      'volta seria eco.',
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
    summary: 'Anexa um evento ao log da sessão, em nome de um agente',
    description:
      'Mesmo caso de uso e mesma atribuição atômica de `seq` da rota humana. ' +
      'Hipóteses do Psicólogo NÃO passam por aqui: têm rota própria, com validação ' +
      'de evidência.',
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
    summary: 'Pagina o event log da sessão para o engine',
    description:
      'Usada para REIDRATAR o histórico de conversa de um agente depois de um ' +
      'restart. A rota humana equivalente é protegida por RBAC; esta, pelo service ' +
      'token.',
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
    summary: 'Executa um turno de LLM medido, com suporte a ferramentas',
    description:
      'O metering é OBRIGATÓRIO: todo turno grava `token_usage`, e é isso que faz o ' +
      'orçamento significar alguma coisa. Não grava evento nenhum — quem narra o ' +
      'event log é o engine. Falha do provider volta em `error` com 200, porque a ' +
      'contabilidade continua válida: o turno gastou mesmo falhando.',
  })
  @ApiCreatedResponse({ type: LlmTurnResponseDto })
  @ApiForbiddenResponse({
    description:
      'Orçamento estourado com `policy=block`, ou service token inválido.',
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
    summary: 'Executa um turno de LLM com a resposta em stream',
    description:
      'Mesma semântica do `llm-turn`, entregue quadro a quadro. O `done` traz o ' +
      '`usage` — sem ele o turno teria saído sem contabilidade.',
  })
  @ApiExtraModels(LlmTurnStreamEventResponseDto)
  @ApiResponse({
    status: 200,
    description: 'Stream de quadros até `done` ou `error`.',
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
    summary: 'Oferece um handoff de um agente para outro',
    description:
      'Nasce em `offered`. Quem aceita é uma PESSOA, pela rota humana — agente não ' +
      'ativa agente.',
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
  @ApiOperation({ summary: 'Cria um épico do backlog' })
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
    summary: 'Cria uma história com RF, RNF, DoD, DoR e regras cobertas',
    description:
      'O `businessRuleIds` é o que alimenta a cobertura regra→história. Cada id tem ' +
      'de referenciar um evento `artifact.business_rule` que EXISTE — a validação ' +
      'recusa id inventado.',
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
  @ApiOperation({ summary: 'Cria uma tarefa dentro de uma história' })
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
    summary: 'Publica uma versão nova do module_map',
    description:
      'O histórico é imutável: cada publicação é uma versão a mais e a vigente é a ' +
      'de maior `version`. Um CICLO de dependência entre módulos faz o mapa ser ' +
      'REJEITADO com 400 — o grafo precisa ser acíclico.',
  })
  @ApiCreatedResponse({ type: ModuleMapResponseDto })
  @ApiBadRequestResponse({ description: 'Ciclo de dependência entre módulos.' })
  moduleMap(
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateModuleMapInternalDto,
  ) {
    return this.createModuleMap.execute(dto.projectId, sessionId, {
      modules: dto.modules,
    });
  }

  @Post(':sessionId/story-modules')
  @ApiOperation({
    summary: 'Associa uma história aos módulos que ela toca',
    description:
      'É a validação cruzada: módulo inexistente no mapa vigente vira pendência de ' +
      'arquitetura em vez de passar despercebido.',
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
    summary: 'Reivindica atomicamente a próxima tarefa pegável do módulo',
    description:
      'ATÔMICO de propósito: com vários dev agents no mesmo módulo, duas ' +
      'reivindicações concorrentes não podem devolver a mesma tarefa. Sem tarefa ' +
      'disponível, devolve vazio em vez de erro.',
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
  @ApiOperation({ summary: 'Move a tarefa de estado ao longo do trabalho' })
  @ApiCreatedResponse({ type: TaskResponseDto })
  @ApiConflictResponse({
    description: 'Transição inválida, ou tarefa de outro agente.',
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
    summary: 'Monta o contexto completo de uma tarefa para o dev agent',
    description:
      'Uma chamada com tudo o que o prompt precisa: a história inteira, as regras de ' +
      'negócio resolvidas e as ADRs aplicáveis. `module` restringe as ADRs às do ' +
      'módulo daquele dev; ADR sem módulo declarado é TRANSVERSAL e entra sempre. ' +
      'Omitir `module` traz o acervo inteiro, que é o que os gates de QA e SecOps ' +
      'querem ao reusar este mesmo contexto.',
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
    summary: 'Monta o contexto inicial do InfraAgent',
    description:
      'O module_map vigente mais as ADRs relevantes de infraestrutura.',
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
    summary: 'Monta o contexto de uma rodada do Psicólogo',
    description:
      'O `alreadyAnalyzed` é o que dá IDEMPOTÊNCIA ao caminho automático: com `true` ' +
      'o worker curto-circuita sem gastar token. As hipóteses anteriores vão junto ' +
      'para a rodada não repetir a si mesma.',
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
    summary: 'Registra uma rodada de análise e as hipóteses dela',
    description:
      'Cada hipótese precisa citar eventos que EXISTEM nesta sessão — evidência ' +
      'inventada é recusada com 400, e é isso que separa hipótese de opinião. A ' +
      'rodada anterior da sessão vira superseded.',
  })
  @ApiCreatedResponse({ type: ProposeHypothesesResponseDto })
  @ApiConflictResponse({
    description: 'Já existe análise current para esta sessão.',
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
    summary: 'Devolve os arquivos de uma PR de infra para os gates lerem',
    description:
      'O conteúdo sai do payload da própria `proposed_action`: artefato de infra ' +
      'nunca toca um worktree, igual às ADRs.',
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
    summary: 'Marca a tarefa como bloqueada, com o motivo',
    description:
      'Não há destrave automático: quem destrava é uma pessoa, pela rota humana. É ' +
      'o que impede um agente de girar em falso indefinidamente.',
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
    summary: 'Registra o parecer de QA ou SecOps sobre a PR de uma tarefa',
    description:
      'O `nextAction` da resposta é o que o engine obedece: `correct` devolve ao ' +
      'dev, `run_secops` avança o gate, `done` libera para o usuário e `blocked` ' +
      'significa que o teto de correções estourou. O MERGE nunca é automático — ' +
      '`done` só significa que chegou a vez do humano.',
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
    summary: 'Registra o desfecho de uma delegação de área',
    description:
      '`completed` (com o parecer), `failed` (com a origem) ou `dispensed` (com ' +
      'a justificativa) — o lead nunca chama esta rota com um desfecho a meio ' +
      'caminho: cada delegação nasce aqui já resolvida.',
  })
  @ApiCreatedResponse({ type: DelegationResponseDto })
  recordDelegationOutcome(@Param('sessionId') sessionId: string, @Body() dto: RecordDelegationInternalDto) {
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
    summary: 'Registra o parecer de QA ou SecOps sobre uma PR de infra',
    description: 'Mesma esteira e mesma máquina de estados das PRs de dev.',
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
    summary: 'Abre a esteira de gates da tarefa, começando pelo QA',
    description: 'Chamado quando a PR do dev agent fica pronta para revisão.',
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
    summary: 'Monta o contexto de uma rodada da Anamnese',
    description:
      'Tudo numa chamada, espelhando o contexto do Psicólogo. Os membros já vêm SEM ' +
      'quem optou por não ser perfilado, e as decisões do usuário na janela vêm por ' +
      'aqui porque não estão no event log. Os eventos em si o engine lê direto do ' +
      'Postgres — trafegá-los por HTTP seria mais caro sem ser mais correto.',
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
    summary: 'Grava os perfis de proficiência derivados na rodada',
    description:
      'Competência fora do catálogo é RECUSADA, e evidência que cita evento de ' +
      'outro projeto também — as duas validações existem porque o modelo erra as ' +
      'duas coisas.',
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
    summary: 'Propõe um patch no arquivo de instrução de um agente',
    description:
      'Vira `proposed_action`, e não escrita direta: mudar o comportamento de um ' +
      'agente é efeito externo e passa pelo mesmo pipeline de aprovação de tudo o ' +
      'mais. É o fechamento do loop hipótese → patch.',
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
   * Cria uma proposed_action a partir de uma ferramenta do agente
   * (write_file fora da whitelist, terminal) — passa pelo mesmo decide/
   * permissions da rota humana; terminal auto_approved é auto-executado.
   */
  @Post(':sessionId/actions')
  @ApiOperation({
    summary: 'Propõe uma ação com efeito externo em nome de um agente',
    description:
      'A porta ÚNICA pela qual um agente toca git, terminal ou gasto. O ' +
      '`permissions.json` decide na criação, e `deny` vence qualquer autonomia ' +
      'concedida ao agente.',
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
