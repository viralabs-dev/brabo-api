import { Injectable, NotFoundException } from '@nestjs/common';
import { SessionRepository } from '../../ports/session-repository.port';
import { HandoffRepository } from '../../ports/handoff-repository.port';

@Injectable()
export class ListHandoffsUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly handoffs: HandoffRepository,
  ) {}

  async execute(projectId: string, sessionId: string) {
    const session = await this.sessions.findInProject(projectId, sessionId);
    if (!session) throw new NotFoundException('Sessão não encontrada');
    return this.handoffs.findBySession(sessionId);
  }
}
