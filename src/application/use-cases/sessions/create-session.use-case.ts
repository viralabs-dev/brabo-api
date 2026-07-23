import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { SessionRepository } from '../../ports/session-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';

@Injectable()
export class CreateSessionUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly sessions: SessionRepository,
    private readonly outbox: OutboxRepository,
  ) {}

  execute(projectId: string, userId: string) {
    return this.unitOfWork.runInTransaction(async () => {
      const session = await this.sessions.create({
        projectId,
        createdBy: userId,
      });

      await this.outbox.append({
        aggregateType: 'session',
        aggregateId: session.id,
        eventType: 'session.created',
        payload: { projectId, createdBy: userId },
      });

      return session;
    });
  }
}
