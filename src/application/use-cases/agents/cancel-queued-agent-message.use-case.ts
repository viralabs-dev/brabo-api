import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';

/** O tipo que o engine grava ao cancelar (RN-673). */
export const EVENTO_DE_MENSAGEM_CANCELADA = 'chat.message_cancelled';

/**
 * Cancela UMA mensagem que espera na fila de um agente conversacional
 * (RN-673, ADR 0191). A decisão do dono: cada mensagem pendente pode ser
 * cancelada, por QUEM A ENVIOU, com o mesmo papel mínimo da rota de mensagem
 * (`developer`, conferido pelo `RolesGuard`).
 *
 * O que a api confere, e por quê aqui:
 *
 *  - a mensagem existe NESTA sessão e é um `chat.message` (404 senão — não diz
 *    se ela existe noutra sessão);
 *  - o ator dela é o chamador (403 nomeado): a fila é de falas de PESSOAS, e
 *    cancelar a fala de outro membro seria editar o que ele disse;
 *  - a sessão aceita conversa (409 `sessao_encerrada`, RN-581): o cancelamento
 *    é evento de conversa, e numa sessão fechada os agentes já pararam.
 *
 * O que ela NÃO confere: se a mensagem ainda está na fila. Quem sabe é o
 * processo do agente no engine, que serializa a corrida com a entrega — a api
 * perguntar ao log antes abriria a janela em que ela é lida entre a leitura e
 * o cancelamento. A recusa dele (já lida, já cancelada) volta como 409 com a
 * frase do engine.
 */
@Injectable()
export class CancelQueuedAgentMessageUseCase {
  constructor(
    private readonly sessionEvents: SessionEventRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly engineClient: ApiToEngineClient,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    agent: string,
    messageId: string,
    userId: string,
  ) {
    const mensagem = await this.sessionEvents.findById(messageId);
    if (
      !mensagem ||
      mensagem.sessionId !== sessionId ||
      mensagem.type !== 'chat.message'
    ) {
      throw new NotFoundException('Mensagem não encontrada nesta sessão');
    }

    if (mensagem.actor.kind !== 'user' || mensagem.actor.id !== userId) {
      throw new ForbiddenException({
        message:
          'Só quem enviou a mensagem pode cancelá-la enquanto ela espera na fila.',
        reason: 'mensagem_de_outra_pessoa',
      });
    }

    await this.appendEvent.garantirQueAceita(
      projectId,
      sessionId,
      EVENTO_DE_MENSAGEM_CANCELADA,
      { kind: 'user', id: userId },
    );

    await this.engineClient.cancelQueuedMessage(
      projectId,
      sessionId,
      agent,
      messageId,
      userId,
    );

    return { ok: true as const };
  }
}
