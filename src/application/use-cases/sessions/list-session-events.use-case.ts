import { Injectable, NotFoundException } from '@nestjs/common';
import { SessionRepository } from '../../ports/session-repository.port';
import {
  SessionEventRepository,
  type ListPaginatedOptions,
} from '../../ports/session-event-repository.port';

@Injectable()
export class ListSessionEventsUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly sessionEvents: SessionEventRepository,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    opts: ListPaginatedOptions,
  ) {
    const session = await this.sessions.findInProject(projectId, sessionId);
    if (!session) throw new NotFoundException('Sessão não encontrada');
    return this.sessionEvents.listPaginated(sessionId, opts);
  }
}
