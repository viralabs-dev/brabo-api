import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { RequireRole } from '../iam/require-role.decorator';
import { ActivateAgentUseCase } from '../../../application/use-cases/agents/activate-agent.use-case';
import { SendAgentMessageUseCase } from '../../../application/use-cases/agents/send-agent-message.use-case';
import { CancelAgentTurnUseCase } from '../../../application/use-cases/agents/cancel-agent-turn.use-case';
import { ConfirmReadinessUseCase } from '../../../application/use-cases/agents/confirm-readiness.use-case';
import { OfferInfraHandoffUseCase } from '../../../application/use-cases/agents/offer-infra-handoff.use-case';
import { ValidateNecessityUseCase } from '../../../application/use-cases/agents/validate-necessity.use-case';
import { AcceptHandoffUseCase } from '../../../application/use-cases/agents/accept-handoff.use-case';
import { ListHandoffsUseCase } from '../../../application/use-cases/agents/list-handoffs.use-case';
import { RequestManualHandoffUseCase } from '../../../application/use-cases/agents/request-manual-handoff.use-case';
import { AnswerStructuredQuestionUseCase } from '../../../application/use-cases/agents/answer-structured-question.use-case';
import { SendAgentMessageDto } from './dto/send-agent-message.dto';
import { AnswerStructuredQuestionDto } from './dto/answer-structured-question.dto';
import { RequestManualHandoffDto } from './dto/request-manual-handoff.dto';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { OkResponseDto } from '../shared/dto/comuns.response.dto';
import {
  AgenteAtivadoResponseDto,
  HandoffResponseDto,
} from './dto/agents.response.dto';

/**
 * Ações do usuário sobre os agentes conversacionais de uma sessão (Fase 3b):
 * iniciar um agente (Criativo por comando do usuário; demais só com handoff
 * accepted — regra no ActivateAgentUseCase), mandar mensagem pro agente ativo,
 * confirmar prontidão (botão que dispara o product_brief), e listar handoffs.
 */
@ApiTags('agents')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Insufficient role on the project.' })
@ApiNotFoundResponse({ description: 'Project, session, or handoff not found.' })
@Controller('projects/:projectId/sessions/:sessionId')
export class AgentsController {
  constructor(
    private readonly activateAgent: ActivateAgentUseCase,
    private readonly sendAgentMessage: SendAgentMessageUseCase,
    private readonly cancelAgentTurn: CancelAgentTurnUseCase,
    private readonly confirmReadiness: ConfirmReadinessUseCase,
    private readonly offerInfraHandoff: OfferInfraHandoffUseCase,
    private readonly validateNecessity: ValidateNecessityUseCase,
    private readonly acceptHandoff: AcceptHandoffUseCase,
    private readonly listHandoffs: ListHandoffsUseCase,
    private readonly requestManualHandoff: RequestManualHandoffUseCase,
    private readonly answerStructuredQuestion: AnswerStructuredQuestionUseCase,
  ) {}

  @Post('agents/:agent/start')
  @RequireRole('developer')
  @ApiParam({
    name: 'agent',
    example: 'criativo',
    description: 'Agent slug.',
  })
  @ApiOperation({
    summary: 'Starts an agent in the session',
    description:
      'Only the Criativo can be started by a direct command. Every other agent ' +
      'requires an ACCEPTED handoff pointing to it — the rule lives in the ' +
      'domain, not here, and trying to bypass it returns 409.',
  })
  @ApiCreatedResponse({ type: AgenteAtivadoResponseDto })
  @ApiConflictResponse({
    description:
      'Agent without an accepted handoff, or already active in the session.',
  })
  start(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Param('agent') agent: string,
    @CurrentUser() user: User,
  ) {
    return this.activateAgent.execute(projectId, sessionId, agent, user.id);
  }

  @Post('agents/:agent/message')
  @RequireRole('developer')
  @ApiParam({
    name: 'agent',
    example: 'po',
    description: 'Slug of the active agent.',
  })
  @ApiOperation({
    summary: 'Sends a message to the active agent',
    description:
      'The response is just the acknowledgment. What the agent replies arrives ' +
      "via the session's event log and the chat SSE — not through this call.",
  })
  @ApiCreatedResponse({ type: OkResponseDto })
  @ApiConflictResponse({
    description: 'The agent is not active in this session.',
  })
  message(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Param('agent') agent: string,
    @CurrentUser() user: User,
    @Body() dto: SendAgentMessageDto,
  ) {
    return this.sendAgentMessage.execute(
      projectId,
      sessionId,
      agent,
      dto.text,
      user.id,
    );
  }

  /**
   * Submissão do formulário de `chat.structured_question` (RN-162): o
   * Criativo pode pedir várias respostas de uma vez, num formulário, em vez
   * de texto livre respondido item por item. As respostas voltam ao agente
   * pelo MESMO caminho de `SendAgentMessageUseCase` — concatenadas numa
   * mensagem `chat.message` — então `agent` é quem vai LER a resposta, do
   * mesmo jeito que em `.../message`.
   */
  @Post('agents/:agent/structured-question/:questionSetId/answer')
  @RequireRole('developer')
  @ApiParam({
    name: 'agent',
    example: 'criativo',
    description:
      'Slug of the agent that asked the questions (and will read the answer).',
  })
  @ApiParam({
    name: 'questionSetId',
    example: '01JC4Z0000EVENTO000000000001',
    description: 'Id of the answered `chat.structured_question` event.',
  })
  @ApiOperation({
    summary: "Answers a set of the agent's structured questions",
    description:
      'Records `chat.structured_question_answered` and resends the answers to the ' +
      'agent as a normal message. A question set can only be answered once.',
  })
  @ApiCreatedResponse({ type: OkResponseDto })
  @ApiConflictResponse({
    description: 'This question set has already been answered.',
  })
  submitStructuredQuestionAnswer(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Param('agent') agent: string,
    @Param('questionSetId') questionSetId: string,
    @CurrentUser() user: User,
    @Body() dto: AnswerStructuredQuestionDto,
  ) {
    return this.answerStructuredQuestion.execute(
      projectId,
      sessionId,
      agent,
      questionSetId,
      dto.answers,
      user.id,
    );
  }

  @Post('agents/:agent/cancel')
  @RequireRole('developer')
  @ApiParam({
    name: 'agent',
    example: 'po',
    description: 'Slug of the active agent.',
  })
  @ApiOperation({
    summary: "Cancels the active agent's turn in progress",
    description:
      'The composer\'s "Stop" button (RN-122): kills the in-flight LLM call in ' +
      'the engine, cutting the connection mid-stream — it saves tokens for real, ' +
      'not just stops rendering on the client. Idempotent: with no turn in ' +
      'progress, it is accepted with no effect.',
  })
  @ApiCreatedResponse({ type: OkResponseDto })
  cancel(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Param('agent') agent: string,
  ) {
    return this.cancelAgentTurn.execute(projectId, sessionId, agent);
  }

  @Post('readiness')
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Confirms that the discovery session with the Criativo is done',
    description:
      "It's the button that triggers the `product_brief` and the handoff to " +
      'the PO. Records `readiness.confirmed` in the event log.',
  })
  @ApiCreatedResponse({ type: OkResponseDto })
  readiness(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: User,
  ) {
    return this.confirmReadiness.execute(projectId, sessionId, user.id);
  }

  /**
   * O usuário confirma que a arquitetura está pronta (Fase 4a — fechamento):
   * dispara o Arquiteto a oferecer o handoff ao InfraAgent. Endpoint
   * dedicado (não reaproveita `readiness`, que é do Criativo).
   */
  @Post('agents/arquiteto/handoff-infra')
  @RequireRole('developer')
  @ApiOperation({
    summary:
      'Confirms the architecture is ready and offers the handoff to Infra',
    description:
      'Dedicated endpoint instead of reusing `readiness`, which belongs to the ' +
      'Criativo: they are two different milestones of the session, and ' +
      'conflating them would make the event log ambiguous.',
  })
  @ApiCreatedResponse({ type: OkResponseDto })
  handoffInfra(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: User,
  ) {
    return this.offerInfraHandoff.execute(projectId, sessionId, user.id);
  }

  /**
   * Gate `necessidade-validada` (Criativo → PO — auditoria fluxo.yml x
   * código, achado B2, RN-406/ADR 0095): o usuário confirma que o
   * `product_brief` que o Criativo consolidou reflete de verdade a
   * necessidade de negócio. Endpoint dedicado — não reaproveita `readiness`
   * (que só exige regra capturada, RN-142) nem o aceite do handoff pelo PO
   * (que é estrutural, sem julgamento de conteúdo).
   */
  @Post('agents/criativo/validate-necessity')
  @RequireRole('developer')
  @ApiOperation({
    summary: "Confirms the Criativo's business need has been validated",
    description:
      'Records `necessity.validated`. Requires the Criativo to have already ' +
      'consolidated a `product_brief` in this session (RN-406) — without it, it ' +
      'is refused: there is nothing to validate.',
  })
  @ApiCreatedResponse({ type: OkResponseDto })
  validateNecessityHandoff(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: User,
  ) {
    return this.validateNecessity.execute(projectId, sessionId, user.id);
  }

  @Get('handoffs')
  @RequireRole('viewer')
  @ApiOperation({ summary: "Lists the session's agent-to-agent handoffs" })
  @ApiOkResponse({ type: [HandoffResponseDto] })
  handoffs(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.listHandoffs.execute(projectId, sessionId);
  }

  /**
   * Handoff manual a agente à escolha (ADR 0109/RN-440): o usuário endereça
   * um handoff a QUALQUER agente do catálogo `addressableAgents()` (lead de
   * área ou agente solo), não só o próximo da cadeia fixa — o caso real é o
   * Staff (ADR 0088), pronto no engine mas só alcançável antes disto pela
   * rota interna. Nasce `offered`, do MESMO jeito que um handoff automático
   * — quem aceita continua sendo `accept`, abaixo, sem caminho novo.
   */
  @Post('handoffs')
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Manually offers a handoff to a chosen agent',
    description:
      "Born as `offered`, exactly like an agent's own `offer_handoff` — " +
      'the only difference is who decided. `toAgent` has to be in the ' +
      'addressable catalog (area lead or area-less agent); a subagent or an ' +
      'unknown slug is refused with 400.',
  })
  @ApiCreatedResponse({ type: HandoffResponseDto })
  requestManual(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: User,
    @Body() dto: RequestManualHandoffDto,
  ) {
    return this.requestManualHandoff.execute(
      projectId,
      sessionId,
      dto.toAgent,
      user.id,
    );
  }

  /**
   * O usuário aceita um handoff oferecido → transiciona pra accepted e ATIVA o
   * agente destino (ex.: o PO). Exercita a regra de ativação (agent-activation).
   */
  @Post('handoffs/:handoffId/accept')
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Accepts a handoff and activates the destination agent',
    description:
      'One thing only: transition to `accepted` AND start the destination ' +
      'agent. It is the normal activation path for every agent other than the ' +
      'Criativo.',
  })
  @ApiCreatedResponse({ type: HandoffResponseDto })
  @ApiConflictResponse({ description: 'The handoff is not in `offered`.' })
  accept(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Param('handoffId') handoffId: string,
    @CurrentUser() user: User,
  ) {
    return this.acceptHandoff.execute(projectId, sessionId, handoffId, user.id);
  }
}
