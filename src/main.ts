// PRIMEIRO import do processo, de propósito: a auto-instrumentação do
// OpenTelemetry faz monkey-patch de `http`, `pg`, `express` e `undici`, e não
// pega em módulo já carregado. Ver src/tracing-boot.ts e src/tracing.ts.
import './tracing-boot';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { DomainTransitionErrorFilter } from './interfaces/http/shared/domain-transition-error.filter';
import { GitProviderErrorFilter } from './interfaces/http/shared/git-provider-error.filter';
import { LlmBindingErrorFilter } from './interfaces/http/shared/llm-binding-error.filter';
import { resolveCorsOrigins } from './infrastructure/security/cors-origins';
import { SwaggerModule } from '@nestjs/swagger';
import { montarDocumento } from './infrastructure/openapi/documento';

async function bootstrap() {
  // `bufferLogs`: as linhas emitidas ANTES de o logger estar pronto ficam na
  // fila e são reemitidas em JSON, em vez de sair no formato default do Nest —
  // senão o começo do log de cada pod não é parseável pelo Loki.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));

  // Cabeçalhos de segurança (Fase 5, item 7). A api não mandava nenhum.
  //
  // `contentSecurityPolicy: false` de propósito: esta api serve JSON, e um CSP
  // aqui não protege nada — quem executa script é a web, e o CSP dela já
  // existe e é mais específico (docker/web/nginx.conf, com o `connect-src`
  // montado por ambiente). Ligar um CSP genérico aqui daria a impressão de
  // cobertura sem acrescentar defesa.
  //
  // `crossOriginResourcePolicy: false` porque a web é OUTRA origem e precisa
  // consumir estas respostas; o default `same-origin` do helmet bloquearia o
  // app inteiro, e o sintoma seria confundido com erro de CORS.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: false,
    }),
  );

  // O refresh da web vive em cookie httpOnly (Fase 7a, item 5). O Express não
  // parseia `Cookie` sozinho, e sem isto `req.cookies` seria `undefined` — o
  // login funcionaria e o refresh falharia, que é o modo de falha mais chato
  // possível: só aparece 15 minutos depois.
  app.use(cookieParser());

  // `credentials: true` com origem EXATA (nunca `*`, e o boot falha se alguém
  // tentar em produção — ver cors-origins.ts). É o que permite o browser
  // mandar o cookie de sessão para uma api em outra origem.
  //
  // `allowedHeaders` explícito a partir do ADR 0035. Sem ele o pacote `cors`
  // reflete o `Access-Control-Request-Headers` do preflight, e é só por causa
  // desse default que o `traceparent` da web passava. Ou seja: a correlação
  // inteira entre os três serviços dependia de um comportamento implícito de
  // biblioteca que nenhum teste cobria. Listar é o mesmo comportamento, dito.
  // A lista tem que conter TODO header que a web manda, senão o preflight
  // bloqueia a chamada — e nenhum teste pega isso, porque teste não faz
  // preflight. Hoje são: `Content-Type` (valor `application/json` não é
  // safelisted), `Authorization`, `X-CSRF-Token` (auth.ts — sem ele login,
  // refresh e logout param no browser) e `traceparent`. `Accept` é safelisted e
  // não precisa constar.
  //
  // `maxAge` acrescentado no ADR 0037. TODA chamada da web é preflighted — o
  // `api-client` manda `Authorization` e `traceparent`, que não são safelisted —
  // então sem cache de preflight cada requisição vira DUAS viagens. O cache do
  // navegador é por URL+método, e com o `refetchInterval` do TanStack Query
  // batendo na mesma URL de novo e de novo, é justamente aí que ele paga.
  //
  // 10 minutos, o mesmo do engine: curto o bastante para uma mudança de
  // `allowedHeaders` não ficar presa no cache do navegador de quem estava com a
  // aba aberta.
  app.enableCors({
    origin: resolveCorsOrigins(),
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-CSRF-Token',
      'traceparent',
    ],
    maxAge: 600,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(
    new DomainTransitionErrorFilter(),
    new GitProviderErrorFilter(),
    new LlmBindingErrorFilter(),
  );
  // Sem isto o SIGTERM mata o processo direto e o `onModuleDestroy` do
  // DrizzleModule nunca roda: o pool do Postgres fica com conexões abertas do
  // lado do servidor a cada rollout ou scale-down. Em Docker isso passava
  // despercebido (o container inteiro sumia); em Kubernetes, onde replicaset e
  // HPA reciclam pods o tempo todo, vira vazamento acumulado no banco.
  app.enableShutdownHooks();

  // Swagger UI (Fase 7b). FORA de produção apenas: a referência de produção é
  // o site de docs, gerado do mesmo documento — servir a superfície inteira
  // num ambiente real não acrescenta nada e dá mapa de graça a quem sondar.
  //
  // Estas duas rotas NÃO aparecem em docs/security-surface.md nem no
  // route-surface.spec.ts, e isso não é esquecimento: `SwaggerModule.setup`
  // monta middleware direto no Express, não um controller, e o teste enumera
  // por `DiscoveryService`. A lacuna está registrada em prosa naquele
  // documento, que é o lugar certo para o que o teste estruturalmente não vê.
  if (process.env.NODE_ENV !== 'production') {
    SwaggerModule.setup('docs', app, montarDocumento(app), {
      jsonDocumentUrl: 'docs-json',
    });
  }

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
