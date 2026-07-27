import { Injectable, NotFoundException } from '@nestjs/common';
import { SessionRepository } from '../../ports/session-repository.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';

/**
 * Um evento do log pelo id, resolvendo A QUAL SESSÃO ele pertence (Fase 4b —
 * fechamento).
 *
 * Existe porque a evidência da Anamnese é de escopo de PROJETO: a janela de
 * uma rodada atravessa várias sessões, então o chip de evidência não sabe
 * para qual sessão navegar. A UI vinha usando a sessão mais RECENTE do
 * projeto, o que caía em "evento não encontrado nesta sessão" toda vez que a
 * evidência era de uma sessão antiga.
 *
 * Difere do `GetSessionEventUseCase`: lá a sessão é conhecida e serve para
 * validar o pertencimento; aqui a sessão é a RESPOSTA. Os dois validam que o
 * evento é do projeto — id de outro projeto é 404, não vazamento.
 */
@Injectable()
export class GetProjectEventUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly sessionEvents: SessionEventRepository,
  ) {}

  async execute(projectId: string, eventId: string) {
    const event = await this.sessionEvents.findById(eventId);
    if (!event) {
      throw new NotFoundException('Evento não encontrado');
    }

    // O evento não carrega projectId — a sessão é quem amarra os dois.
    const session = await this.sessions.findInProject(
      projectId,
      event.sessionId,
    );
    if (!session) {
      throw new NotFoundException('Evento não encontrado neste projeto');
    }

    return event;
  }
}
