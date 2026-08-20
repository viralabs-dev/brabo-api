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
import { GRAPH_PROJECTION_AGGREGATE_TYPE } from '../../../domain/graph/graph-projection-events';
import { Traced } from '../../../infrastructure/observability/traced.decorator';

@Injectable()
export class TransitionSessionUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly sessions: SessionRepository,
    private readonly outbox: OutboxRepository,
    private readonly engineClient: ApiToEngineClient,
  ) {}

  @Traced('application')
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
        // A causa é persistida sempre que informada, não só em estado
        // terminal. O drain de shutdown do engine (Fase 5) transiciona para
        // `closing` com causa `node_shutdown`, e é justamente esse campo que o
        // TerminationClassifier do Psicólogo lê depois — descartá-lo aqui
        // apagaria a única evidência de POR QUE a sessão fechou.
        // `undefined` (nenhuma causa informada) continua não sobrescrevendo o
        // que já estiver gravado.
        terminationReason ?? (terminal ? null : undefined),
      );

      if (terminal) {
        const eventType =
          to === 'closed' ? 'session.closed' : 'session.closed_abnormally';

        await this.outbox.append({
          aggregateType: 'session',
          aggregateId: sessionId,
          eventType,
          payload: { from: current.status, to, projectId },
        });

        // Segunda linha, MESMA transação, para o GraphProjector consolidar a
        // `Interacao` (janela de seq da sessão inteira) — mesmo desenho da
        // instrumentação em AppendSessionEventUseCase, ver
        // graph-projection-events.ts. Fechamento de sessão não passa por
        // `session_events` (é transição pura), então o payload carrega o
        // que o projetor precisa direto, em vez de um `eventId` para reler.
        await this.outbox.append({
          aggregateType: GRAPH_PROJECTION_AGGREGATE_TYPE,
          aggregateId: sessionId,
          eventType,
          payload: { sessionId, projectId },
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
  @Traced('application')
  private async activate(projectId: string, sessionId: string) {
    const current = await this.sessions.findInProject(projectId, sessionId);
    if (!current) throw new NotFoundException('Sessão não encontrada');
    assertTransition(current.status, 'active');

    // Passa o traceparent gravado na criação: é assim que o trabalho do engine
    // continua na mesma trace da sessão, e não numa própria.
    await this.engineClient.startSession(
      sessionId,
      projectId,
      current.traceParent,
    );

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
