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
import { Observable, from, map } from 'rxjs';
import { EngineServiceGuard } from '../auth/engine-service.guard';
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

/**
 * Chamadas internas do engine (Elixir/OTP) — nunca de um usuário humano.
 * Guardadas por EngineServiceGuard (client credentials do Keycloak,
 * client engine-service), não por RBAC de projeto.
 */
@Controller('internal/sessions')
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
   * Usado pelo PsychologistWorker (placeholder, fase 3+ traz a análise
   * real) pra gravar psychologist.hypothesis no event log — reaproveita
   * o mesmo use-case/contrato de seq atômico da rota humana.
   */
  @Post(':sessionId/events')
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
  moduleMap(
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateModuleMapInternalDto,
  ) {
    return this.createModuleMap.execute(dto.projectId, sessionId, {
      modules: dto.modules,
    });
  }

  @Post(':sessionId/story-modules')
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
   * DoR), regras de negócio resolvidas e ADRs do projeto — alimenta as
   * camadas `regras_negocio`/`estado_tarefa` do harness.
   */
  @Get(':sessionId/dev-context')
  devContext(
    @Query('projectId') projectId: string,
    @Query('taskId') taskId: string,
  ) {
    return this.getDevTaskContext.execute(projectId, taskId);
  }

  /**
   * Contexto inicial do InfraAgent (Fase 4a): module_map vigente + ADRs
   * `infraRelevant` do projeto — mesmo espírito de `dev-context`.
   */
  @Get(':sessionId/infra-context')
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
  hypotheses(
    @Param('sessionId') sessionId: string,
    @Body() dto: ProposeHypothesesInternalDto,
  ) {
    return this.proposeHypotheses.execute(dto.projectId, sessionId, {
      tier: dto.tier,
      triggeredBy: dto.triggeredBy,
      eventCount: dto.eventCount,
      hypotheses: dto.hypotheses,
    });
  }

  /**
   * Lê de volta title+files da proposed_action `open_infra_pr` já proposta
   * (Fase 4a) — o `InfraGateRunner` usa isso pra rodar hadolint/gitleaks/
   * semgrep sobre os arquivos SEM worktree (a PR de infra não tem um).
   */
  @Get(':sessionId/infra-artifacts/:prActionId/files')
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
    );
  }

  /**
   * Parecer de um gate de PR (QA/SecOps, Fase 4a) — aplica a máquina de
   * estados do gate, comenta a PR, e devolve pro engine a próxima ação
   * (correct/run_secops/done/blocked).
   */
  @Post(':sessionId/gates/verdict')
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
   * Parecer de um gate de PR de infra (QA/SecOps, Fase 4a — InfraAgent) —
   * mesmo espírito de `gates/verdict`, mas chaveado por `prActionId` (id da
   * proposed_action `open_infra_pr`, único id que o engine conhece de
   * volta) em vez de `taskId` — o artefato de infra não tem task por trás.
   */
  @Post(':sessionId/infra-gates/verdict')
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
  anamneseContext(@Query('projectId') projectId: string) {
    return this.getAnamneseContext.execute(projectId);
  }

  /**
   * Perfis de proficiência emitidos pela Anamnese (Fase 4b) — valida
   * contra o catálogo permitido (guarda-corpo) e a evidência real antes
   * de gravar; rejeição volta pro modelo como tool-result.
   */
  @Post(':sessionId/proficiency')
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
      consumedQueueIds: dto.consumedQueueIds,
    });
  }

  /**
   * Patch de instrução proposto pela Anamnese (Fase 4b): calcula o diff
   * e recusa repropor um patch já negado antes de criar a ação.
   */
  @Post(':sessionId/instruction-patches')
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
