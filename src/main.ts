// PRIMEIRO import do processo, de propósito: a auto-instrumentação do
// OpenTelemetry faz monkey-patch de `http`, `pg`, `express` e `undici`, e não
// pega em módulo já carregado. Ver src/tracing.ts.
import './tracing';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { DomainTransitionErrorFilter } from './interfaces/http/shared/domain-transition-error.filter';
import { GitProviderErrorFilter } from './interfaces/http/shared/git-provider-error.filter';
import { resolveCorsOrigins } from './infrastructure/security/cors-origins';

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

  app.enableCors({ origin: resolveCorsOrigins(), credentials: true });
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
  );
  // Sem isto o SIGTERM mata o processo direto e o `onModuleDestroy` do
  // DrizzleModule nunca roda: o pool do Postgres fica com conexões abertas do
  // lado do servidor a cada rollout ou scale-down. Em Docker isso passava
  // despercebido (o container inteiro sumia); em Kubernetes, onde replicaset e
  // HPA reciclam pods o tempo todo, vira vazamento acumulado no banco.
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
