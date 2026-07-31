import type { DestinationStream } from 'pino';
import type { Options as PinoHttpOptions } from 'pino-http';
import type { Params as PinoParams } from 'nestjs-pino';
import { rotaIgnorada } from './ignored-routes';
import { currentSpanId, currentTraceId } from './trace-context';
import type { TraceStep } from './request-context';

/**
 * Log estruturado JSON com `trace_id` (Fase 5, item 6; legibilidade no ADR 0035).
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
 * LLM, access token, cookie de sessão e secret de client OAuth. `redact` cobre os
 * caminhos por onde eles passariam; a lista é conservadora de propósito — um
 * campo redigido a mais custa nada, um a menos é vazamento permanente no Loki.
 *
 * ## Uma linha de JSON em produção, árvore legível em desenvolvimento
 *
 * Em produção `transport` fica ausente: o pino escreve um `JSON.stringify` por
 * evento, em UMA linha. É requisito, não estética — o Alloy lê o stdout do pod
 * linha a linha (`stage.json`), e JSON indentado quebraria o parser.
 *
 * Em desenvolvimento o `pino-pretty` roda **em processo**, como stream, e não via
 * `transport`. O motivo é concreto: `transport` executa o pretty numa worker
 * thread e as opções passam por structured clone, então `messageFormat` e
 * `customPrettifiers` **como função** não podem ser passados — e são justamente
 * eles que desenham a árvore de camadas. Efeito colateral bom: sem worker thread,
 * o último lote de linhas não se perde num encerramento abrupto.
 */

/**
 * Largura da coluna do nome da camada na árvore.
 *
 * 18 e não 16: `↳ infrastructure` tem exatamente 16 caracteres, então `padEnd(16)`
 * não deixa espaço nenhum antes do nome da classe e a linha sai colada.
 */
const LARGURA_CAMADA = 18;

function carregarPinoPretty(): DestinationStream | undefined {
  try {
    // `require` e não import estático: este módulo é importado sem condição pelo
    // `app.module.ts`, e `pino-pretty` é devDependency — não existe na imagem de
    // produção. Um import no topo seria crash no boot.
    //
    // O try/catch não é redundante com o `isProd`: se algum deploy rodar com
    // `NODE_ENV` indefinido, cair para JSON é o modo de falha certo para um
    // logger; derrubar a api não é.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const construir = require('pino-pretty') as (
      opcoes: Record<string, unknown>,
    ) => DestinationStream;

    return construir({
      translateTime: 'SYS:HH:MM:ss.l',
      // `colorize` fica no default (`isColorSupported`): cor no TTY do
      // `pnpm dev:api`, texto puro quando a saída é redirecionada. Fixar `true`
      // encheria `docker compose logs` de escapes ANSI.
      //
      // O que sai da lista é o que já foi renderizado por outro caminho, ou é
      // ruído numa stream de um serviço só. `layers` NÃO entra aqui: é o campo
      // que o `customPrettifiers` abaixo transforma na árvore, e `ignore` vence
      // prettifier. Já `path` sai — em dev ele é a mesma informação da árvore,
      // numa linha só; em produção é o contrário (não há `layers`, e `path` é o
      // campo que fica).
      ignore: [
        'pid',
        'hostname',
        'service',
        'span_id',
        'req',
        'res',
        'responseTime',
        'url',
        'method',
        'path',
        'duration_ms',
        'layer_count',
      ].join(','),
      messageFormat: (log: Record<string, unknown>, chaveMensagem: string) => {
        // `texto` e não `String(...)`: o valor vem de um objeto de log arbitrário,
        // e `String({})` daria "[object Object]" na cara do leitor.
        const texto = (valor: unknown): string =>
          typeof valor === 'string'
            ? valor
            : typeof valor === 'number' || typeof valor === 'boolean'
              ? String(valor)
              : '';

        const mensagem = texto(log[chaveMensagem]);
        const trace =
          typeof log.trace_id === 'string'
            ? ` [2mtrace=${log.trace_id.slice(0, 8)}[22m`
            : '';

        // Linha do autoLogging do pino-http: mostra a rota, não o texto genérico.
        const res = log.res as { statusCode?: number } | undefined;
        const req = log.req as { method?: string; url?: string } | undefined;
        if (req?.method && res?.statusCode) {
          const ms =
            typeof log.responseTime === 'number'
              ? ` ${log.responseTime}ms`
              : '';
          return `${req.method} ${req.url} → ${res.statusCode}${ms}${trace}`;
        }

        // Linha do caminho: o cabeçalho; a árvore vem do prettifier de `layers`.
        if (typeof log.duration_ms === 'number' && log.path) {
          return `${texto(log.method)} ${texto(log.url)} — ${log.duration_ms}ms${trace}`;
        }

        return `${mensagem}${trace}`;
      },
      customPrettifiers: {
        trace_id: (valor: unknown) => `[2m${String(valor)}[22m`,

        /**
         * O caminho entre camadas, como árvore. É o que o usuário pediu: ver por
         * onde a ação passou e quanto cada passo levou.
         *
         * A indentação vem do `depth` que o decorator mantém. Sob concorrência
         * (`Promise.all` de chamadas decoradas) as profundidades interleavam e a
         * árvore fica aproximada — os caminhos críticos são sequenciais, e a
         * ressalva está registrada no ADR 0035.
         */
        layers: (valor: unknown) => {
          if (!Array.isArray(valor)) return '';
          const passos = valor as TraceStep[];

          const linhas = passos.map((p) => {
            const recuo = '  '.repeat(p.depth + 1);
            const seta = p.depth === 0 ? '' : '↳ ';
            const camada = `${seta}${p.layer}`.padEnd(LARGURA_CAMADA);
            const alvo = `${p.class}.${p.fn}`;
            const falha = p.error ? ` [31m✗ ${p.error}[39m` : '';
            return `${recuo}${camada}${alvo}  ${p.ms}ms${falha}`;
          });

          return `\n${linhas.join('\n')}`;
        },
      },
    });
  } catch {
    return undefined;
  }
}

export function loggerParams(): PinoParams {
  const isProd = process.env.NODE_ENV === 'production';

  const opcoes: PinoHttpOptions = {
    level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),

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
        // Acrescentados no ADR 0035. O token de serviço é o bearer de todo
        // tráfego api <-> engine e NÃO era redigido: se caísse num corpo de erro
        // logado, ia para o Loki em texto claro. Os de DEK são o material da
        // envelope encryption.
        'req.headers["x-brabo-service-token"]',
        'res.headers["x-brabo-service-token"]',
        '*.serviceToken',
        '*.service_token',
        '*.privateKey',
        '*.private_key',
        '*.encryptedDek',
        '*.dek',
      ],
      censor: '[REDIGIDO]',
    },

    // Ver `ignored-routes.ts`: uma definição, três consumidores (aqui, o
    // `ignoreIncomingRequestHook` do OTel e o interceptor de caminho).
    autoLogging: {
      ignore: (req) => rotaIgnorada((req as { url?: string }).url),
    },

    customProps: () => ({ service: 'brabo-api' }),
  };

  if (isProd) return { pinoHttp: opcoes };

  const pretty = carregarPinoPretty();
  return pretty ? { pinoHttp: [opcoes, pretty] } : { pinoHttp: opcoes };
}
