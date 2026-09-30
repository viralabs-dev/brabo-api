import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SessionRepository } from '../../ports/session-repository.port';
import { HandoffRepository } from '../../ports/handoff-repository.port';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { CicloDeVidaDoHandoff } from './ciclo-de-vida-do-handoff.service';
import {
  AppendSessionEventUseCase,
  conflitoDeSessaoEncerrada,
} from '../sessions/append-session-event.use-case';
import {
  ConversaEmSessaoEncerradaError,
  garantirQueSessaoAceitaEvento,
} from '../../../domain/sessions/conversa-em-sessao-encerrada';
import {
  canActivateAgent,
  AgentActivationBlockedError,
} from '../../../domain/sessions/agent-activation';

/**
 * Ativa um agente numa sessão (Fase 3b). A regra de domínio
 * `canActivateAgent` porteia: o Criativo inicia por comando do usuário (sem
 * handoff); os demais só entram com um handoff `accepted` endereçado a eles.
 * Chama o engine ANTES de gravar o `agent.activated` (mirror de
 * TransitionSessionUseCase.activate) pra não logar uma ativação sem processo
 * correspondente no engine.
 */
@Injectable()
export class ActivateAgentUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly handoffs: HandoffRepository,
    private readonly engineClient: ApiToEngineClient,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly ciclo: CicloDeVidaDoHandoff,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    agent: string,
    userId: string,
  ) {
    const session = await this.sessions.findInProject(projectId, sessionId);
    if (!session) throw new NotFoundException('Sessão não encontrada');

    // RN-581: o engine sobe o agente ANTES de o evento ser gravado; recusar
    // só no funil deixaria um conversacional vivo numa sessão encerrada, que é
    // o defeito que a RN fecha pelo outro lado (parar os vivos ao fechar).
    try {
      garantirQueSessaoAceitaEvento(session.status, 'agent.activated', {
        kind: 'user',
        id: userId,
      });
    } catch (error) {
      if (error instanceof ConversaEmSessaoEncerradaError) {
        throw conflitoDeSessaoEncerrada(error);
      }
      throw error;
    }

    const existing = await this.handoffs.findBySession(sessionId);
    if (!canActivateAgent(agent, existing)) {
      throw new ForbiddenException(
        new AgentActivationBlockedError(agent).message,
      );
    }

    await this.engineClient.startAgent(projectId, sessionId, agent);

    await this.appendEvent.execute(projectId, sessionId, {
      type: 'agent.activated',
      actor: { kind: 'user', id: userId },
      payload: { agent },
    });

    // ADR 0182 (RN-635): ativo o agente, nenhuma oferta a ele segue acionável
    // — em nenhuma sessão do projeto. Vale para os dois caminhos que passam
    // por aqui: o aceite (a aceita já é `accepted` e não é tocada) e a
    // ativação direta.
    await this.ciclo.substituirOfertasAoAtivar(projectId, agent);

    return { agent, status: 'active' as const };
  }
}
