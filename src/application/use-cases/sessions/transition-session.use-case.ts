import { Injectable, NotFoundException } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { SessionRepository } from '../../ports/session-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
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
    private readonly engineClient: ApiToEngineClient,
  ) {}

  execute(
    projectId: string,
    sessionId: string,
    to: SessionStatus,
    terminationReason?: string,
  ) {
    if (to === 'active') return this.activate(projectId, sessionId);

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
        terminal ? (terminationReason ?? null) : undefined,
      );

      if (terminal) {
        await this.outbox.append({
          aggregateType: 'session',
          aggregateId: sessionId,
          eventType:
            to === 'closed' ? 'session.closed' : 'session.closed_abnormally',
          payload: { from: current.status, to, projectId },
        });
      }

      return updated;
    });
  }

  /**
   * Chama o engine ANTES de abrir a transação (mirror de
   * provision-repository.use-case.ts, que chama o provider externo fora
   * da transação) — se a chamada falhar, a transição pra 'active' nunca
   * é persistida, evitando uma sessão 'active' na api sem processo
   * correspondente no engine. Revalida sob lock dentro da transação pra
   * fechar a janela entre a checagem inicial e a escrita.
   */
  private async activate(projectId: string, sessionId: string) {
    const current = await this.sessions.findInProject(projectId, sessionId);
    if (!current) throw new NotFoundException('Sessão não encontrada');
    assertTransition(current.status, 'active');

    await this.engineClient.startSession(sessionId, projectId);

    return this.unitOfWork.runInTransaction(async () => {
      const locked = await this.sessions.findInProjectForUpdate(
        projectId,
        sessionId,
      );
      if (!locked) throw new NotFoundException('Sessão não encontrada');
      assertTransition(locked.status, 'active');
      return this.sessions.updateStatus(sessionId, 'active', locked.closedAt);
    });
  }
}
