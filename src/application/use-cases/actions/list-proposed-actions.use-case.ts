import { Injectable, NotFoundException } from '@nestjs/common';
import { SessionRepository } from '../../ports/session-repository.port';
import {
  ProposedActionRepository,
  type ListProposedActionsOptions,
} from '../../ports/proposed-action-repository.port';

@Injectable()
export class ListProposedActionsUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly proposedActions: ProposedActionRepository,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    opts: ListProposedActionsOptions,
  ) {
    const session = await this.sessions.findInProject(projectId, sessionId);
    if (!session) throw new NotFoundException('Sessão não encontrada');
    return this.proposedActions.listPaginated(sessionId, opts);
  }
}
