import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { RequireRole } from '../iam/require-role.decorator';
import { ActivateAgentUseCase } from '../../../application/use-cases/agents/activate-agent.use-case';
import { SendAgentMessageUseCase } from '../../../application/use-cases/agents/send-agent-message.use-case';
import { ConfirmReadinessUseCase } from '../../../application/use-cases/agents/confirm-readiness.use-case';
import { AcceptHandoffUseCase } from '../../../application/use-cases/agents/accept-handoff.use-case';
import { ListHandoffsUseCase } from '../../../application/use-cases/agents/list-handoffs.use-case';
import { SendAgentMessageDto } from './dto/send-agent-message.dto';

/**
 * Ações do usuário sobre os agentes conversacionais de uma sessão (Fase 3b):
 * iniciar um agente (Criativo por comando do usuário; demais só com handoff
 * accepted — regra no ActivateAgentUseCase), mandar mensagem pro agente ativo,
 * confirmar prontidão (botão que dispara o product_brief), e listar handoffs.
 */
@Controller('projects/:projectId/sessions/:sessionId')
export class AgentsController {
  constructor(
    private readonly activateAgent: ActivateAgentUseCase,
    private readonly sendAgentMessage: SendAgentMessageUseCase,
    private readonly confirmReadiness: ConfirmReadinessUseCase,
    private readonly acceptHandoff: AcceptHandoffUseCase,
    private readonly listHandoffs: ListHandoffsUseCase,
  ) {}

  @Post('agents/:agent/start')
  @RequireRole('developer')
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

  @Post('readiness')
  @RequireRole('developer')
  readiness(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: User,
  ) {
    return this.confirmReadiness.execute(projectId, sessionId, user.id);
  }

  @Get('handoffs')
  @RequireRole('viewer')
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
  accept(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Param('handoffId') handoffId: string,
    @CurrentUser() user: User,
  ) {
    return this.acceptHandoff.execute(projectId, sessionId, handoffId, user.id);
  }
}
