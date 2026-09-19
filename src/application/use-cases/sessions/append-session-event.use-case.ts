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
import {
  ARTIFACT_PROJECTABLE_EVENT_TYPES,
  ARTIFACT_PROJECTION_AGGREGATE_TYPE,
} from '../../../domain/artifacts/artifact-projection-events';
import {
  ConversaEmSessaoEncerradaError,
  ehEventoDeConversa,
  garantirQueSessaoAceitaEvento,
} from '../../../domain/sessions/conversa-em-sessao-encerrada';
import { Traced } from '../../../infrastructure/observability/traced.decorator';

/**
 * A recusa da RN-581 como 409 NOMEADO: `reason` é o que o engine reconhece no
 * log e a web mostra. 409 pelo mesmo motivo da trava do tipo: o corpo está
 * certo, quem recusa é o ESTADO do recurso.
 */
export function conflitoDeSessaoEncerrada(
  error: ConversaEmSessaoEncerradaError,
): ConflictException {
  return new ConflictException({
    message: error.message,
    reason: ConversaEmSessaoEncerradaError.REASON,
    status: error.status,
    type: error.type,
  });
}

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
   *
   * ## A trava do estado (RN-581)
   *
   * Sessão `closed`/`closed_abnormally` recusa evento de CONVERSA — ver
   * `conversa-em-sessao-encerrada.ts` para a régua e para o que continua
   * entrando (os consumidores do fechamento). O estado vem do MESMO `UPDATE`
   * que reserva o `seq`, sem consulta extra; a recusa lança dentro da
   * transação, então o incremento é desfeito e o contador segue sem buraco.
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

      const reservado = await this.sessions.incrementSeq(projectId, sessionId);
      if (reservado === null) {
        throw new NotFoundException('Sessão não encontrada');
      }
      try {
        garantirQueSessaoAceitaEvento(
          reservado.status,
          input.type,
          input.actor,
        );
      } catch (error) {
        if (error instanceof ConversaEmSessaoEncerradaError) {
          throw conflitoDeSessaoEncerrada(error);
        }
        throw error;
      }
      const seq = reservado.seq;

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

      // Terceira linha possível, MESMA transação: a projeção dos artefatos em
      // `docs/` (ADR 0148, RN-523). `aggregateId` é o PROJETO, e não a sessão
      // como nas duas de cima — a pasta é do projeto, e o evento de origem só
      // carrega `sessionId`; gravá-lo aqui poupa o projetor de uma consulta
      // por artefato para descobrir algo que este método já tem em mãos.
      if (ARTIFACT_PROJECTABLE_EVENT_TYPES.has(input.type)) {
        await this.outbox.append({
          aggregateType: ARTIFACT_PROJECTION_AGGREGATE_TYPE,
          aggregateId: projectId,
          eventType: input.type,
          payload: { eventId: id },
        });
      }

      return event;
    });
  }

  /**
   * A mesma recusa, ANTES de um efeito colateral. Existe para os casos de uso
   * da conversa que mexem em outra coisa antes de gravar o evento — o
   * `CreateHandoff` cria a linha do handoff, o `AcceptHandoff` a marca
   * `accepted` —, e que sem isto deixariam o efeito gravado e só o evento
   * recusado. Quem grava o evento primeiro (mensagem, prontidão) não precisa:
   * o funil acima já recusa antes de o engine ser chamado.
   *
   * Paga uma leitura, e só quem a chama paga.
   */
  async garantirQueAceita(
    projectId: string,
    sessionId: string,
    type: string,
    actor: Actor,
  ): Promise<void> {
    if (!ehEventoDeConversa(type, actor)) return;
    const sessao = await this.sessions.findInProject(projectId, sessionId);
    if (!sessao) throw new NotFoundException('Sessão não encontrada');
    try {
      garantirQueSessaoAceitaEvento(sessao.status, type, actor);
    } catch (error) {
      if (error instanceof ConversaEmSessaoEncerradaError) {
        throw conflitoDeSessaoEncerrada(error);
      }
      throw error;
    }
  }
}
