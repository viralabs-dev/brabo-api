import { context, propagation, trace } from '@opentelemetry/api';

/**
 * Ferramentas de contexto de trace (Fase 5, item 3).
 *
 * Três operações, cada uma com um motivo específico:
 *
 * - `currentTraceparent()` — serializa o contexto ATIVO em `traceparent` W3C,
 *   para gravar num header HTTP ou no metadado de um evento de outbox.
 * - `contextFromTraceparent()` — o inverso: reconstrói o contexto a partir de
 *   um `traceparent` guardado. É o que faz o trabalho de uma sessão que começou
 *   há uma hora continuar na MESMA trace.
 * - `currentTraceId()` — o id nu, para o log estruturado (item 6) e para
 *   correlacionar no Grafana.
 *
 * Tudo passa pelo propagador global do OTel em vez de montar/parsear a string
 * à mão: o formato tem flags e versão, e escrever isso na mão é como serão
 * introduzidos bugs sutis de amostragem.
 */

/** `traceparent` do contexto ativo, ou `undefined` se não houver span. */
export function currentTraceparent(): string | undefined {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier.traceparent;
}

/** Contexto com o `traceparent` dado como parent REMOTO. */
export function contextFromTraceparent(traceparent: string | null | undefined) {
  if (!traceparent) return context.active();
  return propagation.extract(context.active(), { traceparent });
}

/** trace_id ativo em hex, para o log estruturado. */
export function currentTraceId(): string | undefined {
  const span = trace.getSpanContext(context.active());
  return span?.traceId;
}

/** span_id ativo em hex, para o log estruturado. */
export function currentSpanId(): string | undefined {
  const span = trace.getSpanContext(context.active());
  return span?.spanId;
}

/** Injeta o contexto ativo num objeto de headers, para chamadas HTTP saindo. */
export function injectTraceHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  propagation.inject(context.active(), headers);
  return headers;
}
