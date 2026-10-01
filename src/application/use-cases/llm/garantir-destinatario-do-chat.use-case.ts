import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { SessionRepository } from '../../ports/session-repository.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import {
  MENSAGEM_CHAT_SEM_DESTINATARIO,
  MOTIVO_CHAT_SEM_DESTINATARIO,
  chatSemDestinatarioRecusado,
} from '../../../domain/sessions/chat-sem-destinatario';

/**
 * A guarda da ROTA de chat sem destinatário (RN-682, AT-254): numa sessão
 * consultiva em que nenhum agente foi ativado, `POST .../chat` é 422
 * `destinatario_ausente` ANTES de qualquer efeito — nada é gravado e nenhum
 * modelo é chamado.
 *
 * Mora FORA de `SendChatMessageUseCase` de propósito: o caso de uso tem outro
 * consumidor legítimo, os smokes de provider (`*-provider.smoke.spec.ts`), que
 * o usam como instrumento de ponta a ponta (credencial → chamada → metering)
 * numa sessão sem agente nenhum. A regra é sobre a CONVERSA que chega pela
 * rota, não sobre a chamada ao provider.
 */
@Injectable()
export class GarantirDestinatarioDoChatUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly events: SessionEventRepository,
  ) {}

  async execute(projectId: string, sessionId: string): Promise<void> {
    const session = await this.sessions.findInProject(projectId, sessionId);
    if (!session) throw new NotFoundException('Sessão não encontrada');
    // Só a consultiva paga a leitura: a criativa nunca é recusada aqui.
    if (session.kind !== 'consultiva') return;
    const ativacao = await this.events.findLatestOfTypesInSession(sessionId, [
      'agent.activated',
    ]);
    if (chatSemDestinatarioRecusado(session.kind, ativacao !== null)) {
      throw new UnprocessableEntityException({
        message: MENSAGEM_CHAT_SEM_DESTINATARIO,
        reason: MOTIVO_CHAT_SEM_DESTINATARIO,
      });
    }
  }
}
