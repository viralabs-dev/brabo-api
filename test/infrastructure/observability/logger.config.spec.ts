import { describe, it, expect, afterEach } from 'vitest';
import pino from 'pino';
import type { Options as PinoHttpOptions } from 'pino-http';
import { trace } from '@opentelemetry/api';
import { startTracing } from '../../../src/tracing';
import { loggerParams } from '../../../src/infrastructure/observability/logger.config';

/**
 * O SHAPE da linha de log da api (ADR 0035).
 *
 * Não havia teste nenhum sobre isto, e o que se protege aqui não é formatação —
 * é o CONTRATO DE NOMES, lido por três coisas que não se enxergam entre si:
 *
 * - o `stage.json` do Alloy, que extrai `trace_id` e `level` do stdout do pod;
 * - o `derivedFields` do datasource do Loki, que transforma `trace_id` em link
 *   clicável para o Tempo (`deploy/k8s/helm/grafana-values.yaml`);
 * - as consultas do runbook (`{app="api"} | json | trace_id != ""`).
 *
 * Renomear `trace_id` para `traceId`, ou aninhá-lo, compila e passa em tudo — e
 * destrói a correlação. O mesmo vale para "uma linha por evento": JSON indentado
 * em produção quebra o parser do Alloy, e nada avisaria.
 *
 * A lista de `redact` também é contrato, por outro motivo: o CLAUDE.md proíbe
 * segredo em log, e um caminho a menos é vazamento permanente no Loki.
 */

const AMBIENTE_ORIGINAL = process.env.NODE_ENV;

function opcoesDe(params: ReturnType<typeof loggerParams>): PinoHttpOptions {
  const { pinoHttp } = params;
  return (Array.isArray(pinoHttp) ? pinoHttp[0] : pinoHttp) as PinoHttpOptions;
}

describe('loggerParams', () => {
  afterEach(() => {
    process.env.NODE_ENV = AMBIENTE_ORIGINAL;
  });

  describe('produção', () => {
    it('não usa transport — é o que garante uma linha por evento', () => {
      process.env.NODE_ENV = 'production';
      const params = loggerParams();

      // Objeto simples, não tupla: nenhum stream de pretty no caminho.
      expect(Array.isArray(params.pinoHttp)).toBe(false);
      expect(opcoesDe(params).transport).toBeUndefined();
    });

    it('nunca referencia pino-pretty (que não existe na imagem)', () => {
      // `pino-pretty` é devDependency. Se o caminho de produção o tocasse, a api
      // não subiria — e o teste que pega isso não pode depender de ter a
      // dependência ausente.
      process.env.NODE_ENV = 'production';
      const params = loggerParams();
      expect(JSON.stringify(params.pinoHttp)).not.toContain('pino-pretty');
    });

    it('emite UMA linha de JSON com os campos no topo', () => {
      process.env.NODE_ENV = 'production';

      // O `startTracing()` de verdade, sem endpoint: é o cenário do ADR 0035
      // (contexto ligado, exportação desligada) e o único jeito de afirmar sobre
      // o `trace_id` que o `mixin` lê a cada linha. Registra estado global, o que
      // é seguro porque o vitest usa `pool: 'forks'` — um processo por arquivo.
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      startTracing();

      const linhas: string[] = [];
      const logger = pino(opcoesDe(loggerParams()) as pino.LoggerOptions, {
        write: (linha: string) => linhas.push(linha),
      });

      trace.getTracer('teste').startActiveSpan('t', (span) => {
        logger.info(
          { path: 'interfaces/X.create 1ms → application/Y.execute 2ms' },
          'caminho da requisição',
        );
        span.end();
      });

      expect(linhas).toHaveLength(1);
      // Uma linha só: sem \n interno, e terminando em \n.
      expect(linhas[0].endsWith('\n')).toBe(true);
      expect(linhas[0].trimEnd().includes('\n')).toBe(false);

      const log = JSON.parse(linhas[0]) as Record<string, unknown>;

      // Os nomes que o Alloy e o Loki procuram, no TOPO do objeto.
      expect(log.trace_id).toMatch(/^[0-9a-f]{32}$/);
      expect(log.span_id).toMatch(/^[0-9a-f]{16}$/);
      expect('traceId' in log).toBe(false);
      expect('traceID' in log).toBe(false);

      expect(log.level).toBe('info');
      expect(log.message).toBe('caminho da requisição');
      expect(typeof log.time).toBe('string');
      expect(new Date(log.time as string).toISOString()).toBe(log.time);

      // O caminho contém ` → ` e espaços; se isso quebrasse o JSON, a linha
      // deixaria de ser parseável justo quando há algo interessante nela.
      expect(log.path).toContain('→');
    });
  });

  describe('desenvolvimento', () => {
    it('usa a forma [opções, stream] com o pino-pretty em processo', () => {
      // Em processo e não `transport`: é o que permite `messageFormat` e
      // `customPrettifiers` como FUNÇÃO, que é o que desenha a árvore de camadas.
      // Via `transport` as opções passariam por structured clone e a função seria
      // perdida.
      process.env.NODE_ENV = 'development';
      const params = loggerParams();

      expect(Array.isArray(params.pinoHttp)).toBe(true);
      const [, stream] = params.pinoHttp as [unknown, { write?: unknown }];
      expect(typeof stream.write).toBe('function');
    });

    it('mantém `transport` ausente também aqui', () => {
      process.env.NODE_ENV = 'development';
      expect(opcoesDe(loggerParams()).transport).toBeUndefined();
    });
  });

  describe('customProps', () => {
    it('marca o serviço — mas só no logger com escopo de requisição', () => {
      // `customProps` é opção do **pino-http**, não do pino: ela entra no child
      // logger da requisição. Consequência que vale saber ao caçar log: linha
      // emitida FORA de requisição (boot, timer do DomainGaugesCollector, job)
      // não carrega `service`. Não é contrato do Alloy (que extrai só `trace_id`
      // e `level`), então é nuance, não defeito.
      const customProps = opcoesDe(loggerParams()).customProps!;
      expect(customProps({} as never, {} as never)).toEqual({
        service: 'brabo-api',
      });
    });
  });

  describe('o mixin', () => {
    it('devolve objeto vazio sem span ativa, em vez de levantar', () => {
      // Roda a CADA linha. Levantar aqui derrubaria o log inteiro, não só a
      // correlação.
      const mixin = opcoesDe(loggerParams()).mixin!;
      expect(() => mixin({}, 30, {} as never)).not.toThrow();
    });
  });

  describe('redact', () => {
    const esperados = [
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
      // ADR 0035
      'req.headers["x-brabo-service-token"]',
      'res.headers["x-brabo-service-token"]',
      '*.serviceToken',
      '*.service_token',
      '*.privateKey',
      '*.private_key',
      '*.encryptedDek',
      '*.dek',
    ];

    it.each(esperados)('cobre %s', (caminho) => {
      const redact = opcoesDe(loggerParams()).redact as {
        paths: string[];
        censor: string;
      };
      expect(redact.paths).toContain(caminho);
    });

    it('censura com [REDIGIDO]', () => {
      const redact = opcoesDe(loggerParams()).redact as { censor: string };
      expect(redact.censor).toBe('[REDIGIDO]');
    });

    it('redige de verdade o token de serviço numa linha', () => {
      process.env.NODE_ENV = 'production';
      const linhas: string[] = [];
      const logger = pino(opcoesDe(loggerParams()) as pino.LoggerOptions, {
        write: (linha: string) => linhas.push(linha),
      });

      logger.info({ req: { headers: { 'x-brabo-service-token': 'segredo' } } });

      expect(linhas[0]).not.toContain('segredo');
      expect(linhas[0]).toContain('[REDIGIDO]');
    });
  });

  describe('autoLogging.ignore', () => {
    it.each(['/live', '/health', '/metrics', '/metrics?x=1'])(
      'ignora %s',
      (url) => {
        const autoLogging = opcoesDe(loggerParams()).autoLogging as {
          ignore: (req: unknown) => boolean;
        };
        expect(autoLogging.ignore({ url })).toBe(true);
      },
    );

    it('não ignora rota de domínio', () => {
      const autoLogging = opcoesDe(loggerParams()).autoLogging as {
        ignore: (req: unknown) => boolean;
      };
      expect(autoLogging.ignore({ url: '/projects/p1/sessions' })).toBe(false);
    });
  });
});
