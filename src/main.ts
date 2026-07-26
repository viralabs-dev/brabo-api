import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { DomainTransitionErrorFilter } from './interfaces/http/shared/domain-transition-error.filter';
import { GitProviderErrorFilter } from './interfaces/http/shared/git-provider-error.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173' });
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
