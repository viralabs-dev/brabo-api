import { Injectable } from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { SessionRepository } from '../../ports/session-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { currentTraceparent } from '../../../infrastructure/observability/trace-context';

@Injectable()
export class CreateSessionUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly sessions: SessionRepository,
    private readonly outbox: OutboxRepository,
  ) {}

  /**
   * Cria a sessão e ABRE A TRACE RAIZ dela (Fase 5, item 3).
   *
   * A span `session.create` é curta de propósito. Uma sessão dura minutos ou
   * horas, e uma span OTel só chega ao backend quando termina — manter a raiz
   * aberta todo esse tempo tornaria a sessão invisível no Tempo justamente
   * enquanto ela está acontecendo, e ela desapareceria de vez se a sessão
   * nunca encerrasse direito (que é o caso que o item 4 desta fase trata).
   *
   * Então gravamos o `traceparent` desta span em `sessions.trace_parent`, e
   * todo trabalho posterior o usa como parent remoto: turno de agente, tool
   * call, chamada de LLM, gate e job do Oban compartilham o mesmo `trace_id`, e
   * a sessão inteira é recuperável no Tempo por um id só.
   */
  execute(projectId: string, userId: string) {
    const tracer = trace.getTracer('brabo-api');

    return tracer.startActiveSpan('session.create', async (span) => {
      try {
        span.setAttribute('brabo.project_id', projectId);

        // Dentro da span ativa: é daqui que o traceparent é lido, e é o mesmo
        // contexto que o DrizzleOutboxRepository vai capturar sozinho.
        const traceParent = currentTraceparent() ?? null;

        const session = await this.unitOfWork.runInTransaction(async () => {
          const created = await this.sessions.create({
            projectId,
            createdBy: userId,
            traceParent,
          });

          await this.outbox.append({
            aggregateType: 'session',
            aggregateId: created.id,
            eventType: 'session.created',
            payload: { projectId, createdBy: userId },
          });

          return created;
        });

        span.setAttribute('brabo.session_id', session.id);
        return session;
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        // `end()` no finally: uma span que nunca fecha não é exportada, e o
        // caminho de erro é justamente o que se quer ver no Tempo.
        span.end();
      }
    });
  }
}
