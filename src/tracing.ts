/**
 * Inicialização do OpenTelemetry (Fase 5, item 3).
 *
 * ## Este import tem que ser o PRIMEIRO de main.ts
 *
 * A auto-instrumentação funciona por monkey-patch dos módulos (`http`, `pg`,
 * `express`, `undici`). Se qualquer um deles já tiver sido carregado quando o
 * SDK inicia, o patch não pega — e o sintoma não é erro, é ausência: as spans
 * automáticas simplesmente não existem, e ninguém percebe até procurar por
 * elas. Daí `import './tracing'` antes de `NestFactory`.
 *
 * ## Sem endpoint configurado, não instrumenta
 *
 * `OTEL_EXPORTER_OTLP_ENDPOINT` ausente desliga tudo. Em desenvolvimento
 * (`pnpm dev:api`) e em teste não há coletor, e um exporter tentando entregar
 * para lugar nenhum enche o log de falha de conexão a cada batch.
 */
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
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

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

let sdk: NodeSDK | undefined;

if (endpoint) {
  if (process.env.OTEL_DIAG_LOG === '1') {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
  }

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'brabo-api',
      [ATTR_SERVICE_VERSION]: process.env.BRABO_VERSION ?? 'dev',
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint.replace(/\/$/, '')}/v1/traces`,
    }),
    instrumentations: [
      new HttpInstrumentation({
        // As probes e o scrape são chamados a cada poucos segundos, para
        // sempre. Instrumentá-los enterraria as traces que interessam sob
        // milhares de spans idênticas de `/live` — e o custo de retenção sai
        // todo delas.
        ignoreIncomingRequestHook: (req) => {
          const url = req.url ?? '';
          return (
            url.startsWith('/live') ||
            url.startsWith('/health') ||
            url.startsWith('/metrics')
          );
        },
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
  // investigando quando um pod cai.
  const shutdown = () => {
    void sdk
      ?.shutdown()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

export const tracingEnabled = Boolean(endpoint);
