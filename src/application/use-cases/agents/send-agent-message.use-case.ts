import { Injectable } from '@nestjs/common';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';

/**
 * Mensagem do usuário para um agente ATIVO na sessão (Fase 3b). Grava o
 * `chat.message` (durável no event log mesmo que o engine esteja fora do ar)
 * e então roteia pro engine, que roda o turno no harness e narra a resposta
 * (`agent.response` + artefatos). Sessões SEM agente ativo continuam no
 * SendChatMessageUseCase (chat humano stateless) — este caminho é só pros
 * agentes conversacionais.
 */
@Injectable()
export class SendAgentMessageUseCase {
  constructor(
    private readonly engineClient: ApiToEngineClient,
    private readonly appendEvent: AppendSessionEventUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    agent: string,
    text: string,
    userId: string,
  ) {
    await this.appendEvent.execute(projectId, sessionId, {
      type: 'chat.message',
      actor: { kind: 'user', id: userId },
      payload: { text },
    });

    await this.engineClient.sendAgentMessage(projectId, sessionId, agent, text);

    return { ok: true as const };
  }
}
