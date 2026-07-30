import { describe, it, expect, beforeAll } from 'vitest';
import { context, trace } from '@opentelemetry/api';
import { otlpExportEnabled, startTracing } from '../src/tracing';
import {
  contextFromTraceparent,
  currentSpanId,
  currentTraceId,
  injectTraceHeaders,
} from '../src/infrastructure/observability/trace-context';

/**
 * A fundação da correlação: contexto e propagação SEM coletor (ADR 0035).
 *
 * A regressão que este arquivo existe para pegar é a que motivou o ADR: a api
 * ficava cega em desenvolvimento. O `NodeSDK` só era construído quando
 * `OTEL_EXPORTER_OTLP_ENDPOINT` existia, e sem `start()` não há context manager
 * nem propagador registrados — logo `currentTraceId()` devolvia `undefined`, o
 * `mixin` do pino não acrescentava `trace_id` em linha nenhuma, e o
 * `traceparent` que a web manda em toda requisição era descartado em silêncio.
 * Nada disso falhava; simplesmente não existia.
 *
 * Então o que se afirma aqui é: **com a variável ausente, trace tem que
 * funcionar de todo jeito**. O que a variável decide é só se a span sai do
 * processo.
 *
 * ## Este arquivo registra estado global de propósito
 *
 * `startTracing()` instala context manager, propagador e tracer provider
 * globais. Isso é o oposto do que `test/infrastructure/observability/
 * trace-context.spec.ts` afirma (lá o esperado é no-op, sem SDK). Os dois
 * convivem porque o `vitest.config.ts` usa `pool: 'forks'` com
 * `fileParallelism: false`, ou seja **um processo por arquivo**. Trocar para
 * `pool: 'threads'` faria um dos dois quebrar de um jeito difícil de ler — se
 * isso acontecer, é aqui e lá que se olha.
 */
describe('tracing', () => {
  beforeAll(() => {
    // A suite roda sem `OTEL_EXPORTER_OTLP_ENDPOINT`. É exatamente o cenário de
    // `pnpm dev:api`, e é o cenário sob teste — não definir a variável aqui é
    // deliberado.
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    startTracing();
  });

  describe('otlpExportEnabled', () => {
    it('é falso sem a variável', () => {
      expect(otlpExportEnabled()).toBe(false);
    });

    it('trata string vazia e espaço como ausência', () => {
      // `envsubst` escreve `""` para variável não definida — o mesmo cuidado que
      // o `pick` do runtime-config da web toma. Sem isto, um valor vazio ligaria
      // um exportador para uma URL inválida.
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = '';
      expect(otlpExportEnabled()).toBe(false);
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = '   ';
      expect(otlpExportEnabled()).toBe(false);
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    });
  });

  describe('sem coletor configurado', () => {
    it('cria span com trace e span id de verdade', () => {
      // O coração do ADR 0035. Antes, isto devolvia undefined nos dois.
      const tracer = trace.getTracer('teste');
      tracer.startActiveSpan('span-de-teste', (span) => {
        expect(currentTraceId()).toMatch(/^[0-9a-f]{32}$/);
        expect(currentSpanId()).toMatch(/^[0-9a-f]{16}$/);
        span.end();
      });
    });

    it('injeta traceparent W3C preservando os headers existentes', () => {
      const tracer = trace.getTracer('teste');
      tracer.startActiveSpan('span-de-teste', (span) => {
        const headers = injectTraceHeaders({
          'Content-Type': 'application/json',
          Authorization: 'Bearer abc',
        });

        expect(headers.traceparent).toMatch(
          /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/,
        );
        // A garantia do spec irmão continua valendo com o SDK ligado.
        expect(headers['Content-Type']).toBe('application/json');
        expect(headers.Authorization).toBe('Bearer abc');
        span.end();
      });
    });

    it('adota o traceparent que chega de fora — o mesmo trace_id da web', () => {
      // Esta é a propriedade a que "o mesmo trace entre os três apps" se reduz,
      // e `contextFromTraceparent` não tinha nenhum chamador em produção quando
      // este teste foi escrito: quem extrai é a HttpInstrumentation. Se o
      // propagador não estiver registrado, o trace id recebido é ignorado e este
      // teste falha.
      const traceIdDaWeb = '4bf92f3577b34da6a3ce929d0e0e4736';
      const ctx = contextFromTraceparent(
        `00-${traceIdDaWeb}-00f067aa0ba902b7-01`,
      );

      context.with(ctx, () => {
        const tracer = trace.getTracer('teste');
        tracer.startActiveSpan('filha', (span) => {
          expect(currentTraceId()).toBe(traceIdDaWeb);
          span.end();
        });
      });
    });
  });

  describe('startTracing', () => {
    it('é idempotente e não empilha handler de desligamento', () => {
      // Sem a guarda, uma segunda chamada registraria outro context manager e
      // outro `process.once('SIGTERM')` — e dois handlers de flush chamando
      // `process.exit(0)` é corrida na hora do shutdown, o momento em que menos
      // se quer uma.
      const antes = process.listenerCount('SIGTERM');
      expect(() => startTracing()).not.toThrow();
      expect(() => startTracing()).not.toThrow();
      expect(process.listenerCount('SIGTERM')).toBe(antes);
    });

    it('informa que a exportação está desligada', () => {
      expect(startTracing()).toEqual({ exporting: false });
    });
  });
});
