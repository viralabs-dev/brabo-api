/**
 * Exporta o documento OpenAPI para a saída padrão (Fase 7b, item 7).
 *
 * ## Por que stdout e não escrita direta
 *
 * Quem grava o arquivo é `scripts/docs/generate.mjs`, pela função `escrever()`
 * — a mesma que já grava `scripts.md` e os blocos gerados. É ela que dá o modo
 * `--check` de graça: em vez de escrever, compara com o commitado e reprova.
 * Se este script gravasse por conta própria, `docs:check` teria de reimplementar
 * a comparação, e o modo check passaria a MEXER no working tree — que é
 * exatamente o que ele promete não fazer.
 *
 * ## Não precisa de banco, mas precisa do adapter HTTP
 *
 * `createApplicationContext` seria o instinto — não sobe servidor. Mas o
 * `SwaggerScanner` chama `app.getHttpAdapter().getType()` para saber se está
 * diante de Express ou Fastify, e o contexto não tem adapter nenhum: falha com
 * `app.getHttpAdapter is not a function`. Então `create()` mesmo, sem
 * `listen()`: o adapter existe, nenhuma porta é aberta.
 *
 * Banco, esse sim, não é preciso: o `Pool` do `pg` é preguiçoso —
 * `drizzle-client.ts` só o CONSTRÓI, e nenhum módulo consulta de forma
 * bloqueante no boot. É isso que permite `pnpm docs:generate` (e o
 * `docs-check.yml`, que não tem service container) rodarem sem Postgres.
 *
 * O `app.close()` no fim não é higiene: o `DomainGaugesCollector` agenda um
 * `setInterval` em `onModuleInit`, e sem o `onModuleDestroy` que o `close()`
 * dispara o processo nunca terminaria.
 *
 * Uso: pnpm --filter api openapi:export
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../app.module';
import { configDoOpenapi } from '../infrastructure/openapi/documento';
import { serializarDocumento } from '../infrastructure/openapi/normalizar';

async function main() {
  // `logger: false` porque a saída ÚTIL deste processo é o JSON no stdout;
  // uma linha de boot do Nest ali corromperia o arquivo gerado.
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.init();

  const documento = SwaggerModule.createDocument(app, configDoOpenapi());

  process.stdout.write(serializarDocumento(documento));
  await app.close();
}

void main();
