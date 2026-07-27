import type { Params as PinoParams } from 'nestjs-pino';
import { currentSpanId, currentTraceId } from './trace-context';

/**
 * Log estruturado JSON com `trace_id` (Fase 5, item 6).
 *
 * ## Por que o trace_id entra por `mixin`
 *
 * O `mixin` é avaliado a CADA linha de log, lendo o contexto OTel ativo naquele
 * instante. É o que faz uma linha emitida no meio de um tool call carregar o
 * trace daquele tool call, sem que nenhum ponto de log precise passar id
 * nenhum. A alternativa — um logger por requisição — não cobriria log emitido
 * de dentro de um job, de um Task ou de um handler de evento.
 *
 * O nome do campo é `trace_id`, e não `traceId`: é o que o `derivedFields` do
 * datasource do Loki procura para transformar a linha em link para o Tempo (ver
 * deploy/k8s/helm/grafana-values.yaml). Renomear aqui quebra a correlação
 * clicável sem quebrar teste nenhum.
 *
 * ## Redaction não é opcional
 *
 * O CLAUDE.md proíbe segredo em log, e este processo manuseia chave de API de
 * LLM, access token, cookie de sessão e secret de client OAuth. `redact` cobre os caminhos
 * por onde eles passariam; a lista é conservadora de propósito — um campo
 * redigido a mais custa nada, um a menos é vazamento permanente no Loki.
 */
export function loggerParams(): PinoParams {
  const isProd = process.env.NODE_ENV === 'production';

  return {
    pinoHttp: {
      level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),

      // JSON em produção; legível para gente em desenvolvimento. `pino-pretty`
      // é devDependency e não existe na imagem, então só é referenciado quando
      // NÃO é produção.
      transport: isProd
        ? undefined
        : { target: 'pino-pretty', options: { singleLine: true } },

      messageKey: 'message',
      // `timestamp` em ISO-8601 e não epoch: é o que o Loki e qualquer humano
      // leem sem conversão.
      timestamp: () => `,"time":"${new Date().toISOString()}"`,

      formatters: {
        level: (label: string) => ({ level: label }),
      },

      mixin: () => {
        const traceId = currentTraceId();
        const spanId = currentSpanId();
        return traceId ? { trace_id: traceId, span_id: spanId } : {};
      },

      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          '*.apiKey',
          '*.api_key',
          '*.access_token',
          '*.refresh_token',
          '*.clientSecret',
          '*.client_secret',
          '*.password',
          '*.secret',
          '*.token',
        ],
        censor: '[REDIGIDO]',
      },

      // As probes e o scrape do Prometheus batem a cada poucos segundos, para
      // sempre. Sem isto, o log útil fica enterrado sob elas e o custo de
      // retenção no Loki é quase todo ruído.
      autoLogging: {
        ignore: (req) => {
          const url = (req as { url?: string }).url ?? '';
          return (
            url.startsWith('/live') ||
            url.startsWith('/health') ||
            url.startsWith('/metrics')
          );
        },
      },

      customProps: () => ({ service: 'brabo-api' }),
    },
  };
}
