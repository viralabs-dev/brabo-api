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
import { AcceptHandoffUseCase } from '../../../application/use-cases/agents/accept-handoff.use-case';
import { ListHandoffsUseCase } from '../../../application/use-cases/agents/list-handoffs.use-case';
import { SendAgentMessageDto } from './dto/send-agent-message.dto';
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
@ApiTags('agentes')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Papel insuficiente no projeto.' })
@ApiNotFoundResponse({ description: 'Projeto, sessão ou handoff inexistente.' })
@Controller('projects/:projectId/sessions/:sessionId')
export class AgentsController {
  constructor(
    private readonly activateAgent: ActivateAgentUseCase,
    private readonly sendAgentMessage: SendAgentMessageUseCase,
    private readonly cancelAgentTurn: CancelAgentTurnUseCase,
    private readonly confirmReadiness: ConfirmReadinessUseCase,
    private readonly offerInfraHandoff: OfferInfraHandoffUseCase,
    private readonly acceptHandoff: AcceptHandoffUseCase,
    private readonly listHandoffs: ListHandoffsUseCase,
  ) {}

  @Post('agents/:agent/start')
  @RequireRole('developer')
  @ApiParam({
    name: 'agent',
    example: 'criativo',
    description: 'Slug do agente.',
  })
  @ApiOperation({
    summary: 'Sobe um agente na sessão',
    description:
      'Só o Criativo pode ser iniciado por comando direto. Todos os outros exigem um ' +
      'handoff ACEITO apontando para eles — a regra está no domínio, não aqui, e ' +
      'tentar furá-la responde 409.',
  })
  @ApiCreatedResponse({ type: AgenteAtivadoResponseDto })
  @ApiConflictResponse({
    description: 'Agente sem handoff aceito, ou já ativo na sessão.',
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
    description: 'Slug do agente ativo.',
  })
  @ApiOperation({
    summary: 'Envia uma mensagem ao agente ativo',
    description:
      'A resposta é só o aceite. O que o agente responde chega pelo event log da ' +
      'sessão e pelo SSE de chat — não por esta chamada.',
  })
  @ApiCreatedResponse({ type: OkResponseDto })
  @ApiConflictResponse({ description: 'O agente não está ativo nesta sessão.' })
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

  @Post('agents/:agent/cancel')
  @RequireRole('developer')
  @ApiParam({
    name: 'agent',
    example: 'po',
    description: 'Slug do agente ativo.',
  })
  @ApiOperation({
    summary: 'Cancela o turno em curso do agente ativo',
    description:
      'O botão "Parar" do composer (RN-121): mata a chamada ao LLM em curso no ' +
      'engine, cortando a conexão no meio — economiza token de verdade, não só ' +
      'para de renderizar no cliente. Idempotente: sem turno em curso, é aceito ' +
      'sem efeito.',
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
    summary: 'Confirma que o levantamento com o Criativo terminou',
    description:
      'É o botão que dispara o `product_brief` e o handoff para o PO. Registra ' +
      '`readiness.confirmed` no event log.',
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
      'Confirma que a arquitetura está pronta e oferece o handoff ao Infra',
    description:
      'Endpoint dedicado em vez de reaproveitar `readiness`, que é do Criativo: ' +
      'são dois marcos diferentes da sessão e confundi-los tornaria o event log ambíguo.',
  })
  @ApiCreatedResponse({ type: OkResponseDto })
  handoffInfra(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: User,
  ) {
    return this.offerInfraHandoff.execute(projectId, sessionId, user.id);
  }

  @Get('handoffs')
  @RequireRole('viewer')
  @ApiOperation({ summary: 'Lista os handoffs entre agentes da sessão' })
  @ApiOkResponse({ type: [HandoffResponseDto] })
  handoffs(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.listHandoffs.execute(projectId, sessionId);
  }

  /**
   * O usuário aceita um handoff oferecido → transiciona pra accepted e ATIVA o
   * agente destino (ex.: o PO). Exercita a regra de ativação (agent-activation).
   */
  @Post('handoffs/:handoffId/accept')
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Aceita um handoff e ativa o agente de destino',
    description:
      'Uma coisa só: passar para `accepted` E subir o agente destino. É o caminho ' +
      'normal de ativação de todo agente que não seja o Criativo.',
  })
  @ApiCreatedResponse({ type: HandoffResponseDto })
  @ApiConflictResponse({ description: 'O handoff não está em `offered`.' })
  accept(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Param('handoffId') handoffId: string,
    @CurrentUser() user: User,
  ) {
    return this.acceptHandoff.execute(projectId, sessionId, handoffId, user.id);
  }
}
