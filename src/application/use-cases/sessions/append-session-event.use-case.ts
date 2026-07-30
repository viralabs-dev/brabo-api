import { Injectable, NotFoundException } from '@nestjs/common';
import { ulid } from 'ulid';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { SessionRepository } from '../../ports/session-repository.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import type { Actor } from '../../../domain/sessions/session-event.entity';
import { Traced } from '../../../infrastructure/observability/traced.decorator';

export interface AppendSessionEventInput {
  type: string;
  actor: Actor;
  payload: Record<string, unknown>;
}

@Injectable()
export class AppendSessionEventUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly sessions: SessionRepository,
    private readonly sessionEvents: SessionEventRepository,
    private readonly outbox: OutboxRepository,
  ) {}

  /**
   * `incrementSeq` toma um lock de linha na sessão (UPDATE), então
   * chamadas concorrentes para a MESMA sessão serializam aqui — sem
   * gaps e sem duplicidade, sem precisar de retry loop.
   */
  @Traced('application')
  execute(
    projectId: string,
    sessionId: string,
    input: AppendSessionEventInput,
  ) {
    return this.unitOfWork.runInTransaction(async () => {
      const seq = await this.sessions.incrementSeq(projectId, sessionId);
      if (seq === null) throw new NotFoundException('Sessão não encontrada');

      const id = ulid();
      const event = await this.sessionEvents.append({
        id,
        sessionId,
        seq,
        type: input.type,
        actor: input.actor,
        payload: input.payload,
      });

      await this.outbox.append({
        aggregateType: 'session',
        aggregateId: sessionId,
        eventType: 'session_event.appended',
        payload: { eventId: id, seq, type: input.type },
      });

      return event;
    });
  }
}
