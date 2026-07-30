/**
 * Inicialização do OpenTelemetry (Fase 5, item 3; revisto no ADR 0035).
 *
 * ## `startTracing()` tem que ser a PRIMEIRA coisa de main.ts
 *
 * A auto-instrumentação funciona por monkey-patch dos módulos (`http`, `pg`,
 * `express`, `undici`). Se qualquer um deles já tiver sido carregado quando o
 * SDK inicia, o patch não pega — e o sintoma não é erro, é ausência: as spans
 * automáticas simplesmente não existem, e ninguém percebe até procurar por
 * elas. Daí a chamada antes de `NestFactory`.
 *
 * É função exportada, e não efeito colateral de import, por um motivo concreto:
 * `test/infrastructure/observability/trace-context.spec.ts` afirma que sem SDK
 * ativo a API vira no-op. Com registro no import, qualquer spec que importasse
 * este módulo por transitividade quebraria aquela afirmação sem tocar nela.
 *
 * ## Criar telemetria e ENTREGAR telemetria são coisas separadas
 *
 * Até o ADR 0026 as duas viviam atrás do mesmo `if`: sem
 * `OTEL_EXPORTER_OTLP_ENDPOINT`, o SDK não subia. O custo era invisível e caro —
 * em desenvolvimento, que é exatamente onde mais se precisa ler um trace, não
 * havia contexto de trace NENHUM. Sem `start()` não há context manager nem
 * propagador registrados, logo `currentTraceId()` devolvia `undefined`, o
 * `mixin` do pino não acrescentava nada, e o `traceparent` que a web manda em
 * toda requisição era silenciosamente descartado.
 *
 * Agora o SDK sobe SEMPRE. O que a variável decide é só o destino:
 *
 * - **com endpoint** → `traceExporter` OTLP, e o SDK deriva um
 *   `BatchSpanProcessor` em cima dele;
 * - **sem endpoint** → `spanProcessors` explícito com `NoopSpanProcessor`.
 *
 * O `spanProcessors` explícito não é decoração: sem ele o SDK cai em
 * `getSpanProcessorsFromEnv()`, que com `OTEL_TRACES_EXPORTER` vazio monta um
 * exportador OTLP apontado para `localhost:4318` — o "exportador entregando
 * para lugar nenhum" que o comentário antigo queria evitar e que o `if` não
 * evitava. E ele precisa ter pelo menos um elemento porque o
 * `sdk.start()` só registra o tracer provider global quando
 * `spanProcessors.length > 0`; sem provider, a span nasce inválida, o
 * propagador não injeta nada e nada disto funciona.
 *
 * `NoopSpanProcessor` é seguro para memória: o `onEnd` não guarda nada, então a
 * span é lixo assim que sai de escopo. As alternativas não são —
 * `BatchSpanProcessor` com exportador morto retém 2048 spans e fica retentando,
 * e `InMemorySpanExporter` cresce um array para sempre.
 */
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
// `tracing` é o re-export de `@opentelemetry/sdk-trace-base` feito pelo barrel
// do sdk-node. Carrega uma marca `@deprecated`, e é usado de propósito: pegar
// `NoopSpanProcessor` daqui evita acrescentar dependência direta só para uma
// classe que já está instalada como transitiva.
import { NodeSDK, tracing } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { rotaIgnorada } from './infrastructure/observability/ignored-routes';

let sdk: NodeSDK | undefined;

/** `true` quando há coletor configurado, ou seja, quando a span vai sair daqui. */
export function otlpExportEnabled(): boolean {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  return Boolean(endpoint && endpoint.trim() !== '');
}

/**
 * Registra contexto, propagação W3C e auto-instrumentação. Idempotente.
 *
 * Devolve o resumo do que ficou ligado, para o boot poder DIZER o estado em vez
 * de deixar inferir — ausência de telemetria passar despercebida foi justamente
 * o defeito que o ADR 0035 corrige.
 */
export function startTracing(): { exporting: boolean } {
  const exporting = otlpExportEnabled();
  if (sdk) return { exporting };

  if (process.env.OTEL_DIAG_LOG === '1') {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
  }

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '';

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'brabo-api',
      [ATTR_SERVICE_VERSION]: process.env.BRABO_VERSION ?? 'dev',
    }),

    // Um dos dois, nunca os dois: `spanProcessors` vence `traceExporter` e o
    // exportador seria ignorado em silêncio.
    ...(exporting
      ? {
          traceExporter: new OTLPTraceExporter({
            url: `${endpoint.replace(/\/$/, '')}/v1/traces`,
          }),
        }
      : { spanProcessors: [new tracing.NoopSpanProcessor()] }),

    // Sampler e propagador ficam no default de propósito:
    // `parentbased_always_on` honra o `-01` que a web manda e segue
    // configurável por `OTEL_TRACES_SAMPLER` em produção; o propagador default
    // já é o composto W3C tracecontext + baggage, que é o contrato do ADR 0026.
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => rotaIgnorada(req.url),
      }),
      new ExpressInstrumentation(),
      // Cada query vira span filha. É o que mostra "este tool call gastou 400ms
      // esperando o Postgres" sem instrumentar repositório nenhum à mão.
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
      // Os SDKs de Anthropic e OpenAI usam fetch/undici por baixo.
      new UndiciInstrumentation(),
    ],
  });

  sdk.start();

  // Flush no desligamento: sem isto, as spans do último batch morrem com o
  // processo — e o último batch é justamente o que contém o erro que se está
  // investigando quando um pod cai. Com o `NoopSpanProcessor` é no-op, e
  // registrar sempre custa menos que um `if` que alguém precise conferir.
  const shutdown = () => {
    void sdk
      ?.shutdown()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  return { exporting };
}
