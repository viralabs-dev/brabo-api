import { Injectable, NotFoundException } from '@nestjs/common';
import { SessionRepository } from '../../ports/session-repository.port';

@Injectable()
export class GetSessionUseCase {
  constructor(private readonly sessions: SessionRepository) {}

  async execute(projectId: string, sessionId: string) {
    const session = await this.sessions.findInProject(projectId, sessionId);
    if (!session) throw new NotFoundException('Sessão não encontrada');
    return session;
  }
}
