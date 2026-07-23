import { Injectable } from '@nestjs/common';
import { SessionRepository } from '../../ports/session-repository.port';

@Injectable()
export class ListSessionsForProjectUseCase {
  constructor(private readonly sessions: SessionRepository) {}

  execute(projectId: string) {
    return this.sessions.listForProject(projectId);
  }
}
