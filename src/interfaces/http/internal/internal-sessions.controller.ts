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
    return this.reportTermination.execute(dto.projectId, sessionId, dto.to);
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
