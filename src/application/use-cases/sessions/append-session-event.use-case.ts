import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ulid } from 'ulid';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { SessionRepository } from '../../ports/session-repository.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import type { Actor } from '../../../domain/sessions/session-event.entity';
import {
  EVENTO_DE_EXECUCAO,
  SessionKindNaoExecutaError,
  garantirQuePodeAtivarExecucao,
} from '../../../domain/sessions/session-kind';
import {
  GRAPH_PROJECTABLE_EVENT_TYPES,
  GRAPH_PROJECTION_AGGREGATE_TYPE,
} from '../../../domain/graph/graph-projection-events';
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
   *
   * ## A trava do tipo (FASE 20, RN-097)
   *
   * `execution.activated` só entra em sessão `criativa`. A checagem mora AQUI,
   * e não no `ActivateExecutionUseCase`, porque este é o funil: os dois
   * caminhos que gravam evento — a rota do usuário e a `/internal/*` do engine
   * — passam por este método. Travar no caso de uso deixaria o outro aberto, e
   * um evento gravado por fora reescreveria calado o que a sessão é.
   */
  @Traced('application')
  execute(
    projectId: string,
    sessionId: string,
    input: AppendSessionEventInput,
  ) {
    return this.unitOfWork.runInTransaction(async () => {
      // A leitura extra é paga só pelo evento de execução. Todo append
      // pagá-la seria uma consulta a mais no caminho mais quente do produto
      // para responder uma pergunta que só um tipo de evento faz.
      if (input.type === EVENTO_DE_EXECUCAO) {
        const sessao = await this.sessions.findInProject(projectId, sessionId);
        if (!sessao) throw new NotFoundException('Sessão não encontrada');
        try {
          garantirQuePodeAtivarExecucao(sessao.kind);
        } catch (error) {
          // 409, e não 400: o corpo da requisição está correto: quem recusa é
          // o ESTADO do recurso — a mesma leitura que a máquina de estados de
          // sessão já usa para salto inválido.
          if (error instanceof SessionKindNaoExecutaError) {
            throw new ConflictException(error.message);
          }
          throw error;
        }
      }

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

      // Segunda linha de outbox, MESMA transação, SÓ para o tipo de evento
      // que a memória do grafo consome (RN-413/414/415, Onda 2 —
      // GraphProjector). `aggregateType` distinto do `'session'` de cima é
      // o que evita a corrida contra `Engine.Outbox.Drain` — ver
      // `graph-projection-events.ts`. Payload mínimo (só o id do evento):
      // o projetor relê o envelope completo do event log na hora de
      // projetar, nunca confia numa cópia estale aqui.
      if (GRAPH_PROJECTABLE_EVENT_TYPES.has(input.type)) {
        await this.outbox.append({
          aggregateType: GRAPH_PROJECTION_AGGREGATE_TYPE,
          aggregateId: sessionId,
          eventType: input.type,
          payload: { eventId: id },
        });
      }

      return event;
    });
  }
}
