import { Injectable, NotFoundException } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { SessionRepository } from '../../ports/session-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import {
  assertTransition,
  isTerminal,
  type SessionStatus,
} from '../../../domain/sessions/session-state-machine';

@Injectable()
export class TransitionSessionUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly sessions: SessionRepository,
    private readonly outbox: OutboxRepository,
  ) {}

  execute(projectId: string, sessionId: string, to: SessionStatus) {
    return this.unitOfWork.runInTransaction(async () => {
      const current = await this.sessions.findInProjectForUpdate(
        projectId,
        sessionId,
      );
      if (!current) throw new NotFoundException('Sessão não encontrada');

      assertTransition(current.status, to);

      const terminal = isTerminal(to);
      const updated = await this.sessions.updateStatus(
        sessionId,
        to,
        terminal ? new Date() : current.closedAt,
      );

      if (terminal) {
        await this.outbox.append({
          aggregateType: 'session',
          aggregateId: sessionId,
          eventType:
            to === 'closed' ? 'session.closed' : 'session.closed_abnormally',
          payload: { from: current.status, to },
        });
      }

      return updated;
    });
  }
}
