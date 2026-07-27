import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

/**
 * Aplica as migrations do Drizzle — o passo de migração da imagem de PRODUÇÃO.
 *
 * Por que não `drizzle-kit migrate` (o que o dev usa): `drizzle-kit` é
 * devDependency, e a imagem de produção não leva devDependencies. O migrator
 * programático vem de `drizzle-orm`, que é dependency de runtime, então roda na
 * mesma imagem sem inflá-la. É o MESMO mecanismo que o `globalSetup` do vitest
 * já usa em `test/support/global-setup.ts` — nada de caminho novo e não testado.
 *
 * Roda como serviço one-shot (ver docker-compose.prod.yml): as réplicas de app
 * NÃO migram no boot, senão duas subindo juntas competem pela mesma migration.
 *
 * `MIGRATIONS_FOLDER` existe porque o caminho difere entre rodar do fonte
 * (`./src/db/migrations`) e rodar do compilado dentro da imagem
 * (`/app/db/migrations`, copiado no Dockerfile — o `.sql` não é compilado pelo
 * tsc, é copiado).
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL é obrigatória para migrar');
  }

  const migrationsFolder =
    process.env.MIGRATIONS_FOLDER ?? './src/db/migrations';

  const pool = new Pool({ connectionString: url });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder });
    console.log(`[migrate] migrations aplicadas de ${migrationsFolder}`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('[migrate] falhou:', error);
  process.exit(1);
});
