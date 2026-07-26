import { Injectable, NotFoundException } from '@nestjs/common';
import { SessionRepository } from '../../ports/session-repository.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';

/**
 * Um evento do log pelo id (Fase 4b — fechamento).
 *
 * Existe pra a evidência das hipóteses do Psicólogo ser NAVEGÁVEL de
 * verdade. A listagem (`ListSessionEventsUseCase`) é paginada e o feed da
 * UI filtra ruído de máquina — justamente os tipos que o Psicólogo mais
 * cita (`agent.response`, `tool.call`, `tool.result`). Sem buscar por id, o
 * chip de evidência navegava para um log onde o evento citado podia
 * simplesmente não estar renderizado.
 *
 * A checagem de pertencimento é a mesma de
 * `ProposeHypothesesUseCase.resolveKnownEventIds`: o evento tem que existir
 * E ser desta sessão — id de outra sessão é 404, não vazamento.
 */
@Injectable()
export class GetSessionEventUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly sessionEvents: SessionEventRepository,
  ) {}

  async execute(projectId: string, sessionId: string, eventId: string) {
    const session = await this.sessions.findInProject(projectId, sessionId);
    if (!session) throw new NotFoundException('Sessão não encontrada');

    const event = await this.sessionEvents.findById(eventId);
    if (!event || event.sessionId !== sessionId) {
      throw new NotFoundException('Evento não encontrado nesta sessão');
    }

    return event;
  }
}
