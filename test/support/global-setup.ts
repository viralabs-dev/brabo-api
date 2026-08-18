import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

// Banco de dev (mesmo do docker-compose) e uma database separada só
// para os testes, para nunca sujar os dados de desenvolvimento.
const ADMIN_DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://brabo:brabo@localhost:5432/brabo';
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://brabo:brabo@localhost:5432/brabo_test';

const DUPLICATE_DATABASE = '42P04';

export default async function setup() {
  const adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
  try {
    await adminPool.query('CREATE DATABASE brabo_test');
  } catch (error) {
    if ((error as { code?: string }).code !== DUPLICATE_DATABASE) throw error;
  } finally {
    await adminPool.end();
  }

  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  await ensureEngineFixture(pool);
  await pool.end();
}

/**
 * `engine.dev_agent_states` (RN-409) — tabela do ENGINE (Ecto, prefix
 * "engine"), não da api. `brabo_test` só recebe as migrations do Drizzle
 * acima; as do engine (`mix ecto.migrate`) não rodam neste job (sem Elixir
 * no `test-ts` do CI). Sem isto, `DrizzleProjectsSummaryRepository` — que lê
 * esta tabela via SQL cru (mesmo caminho de `engine.oban_peers` em
 * `medir-execucao.ts`) — falharia com "relation does not exist" em TODO
 * teste que chama `summarizeForWorkspace`.
 *
 * Fixture MÍNIMA e DECLARADA, não um segundo migrator: só as colunas que a
 * consulta lê (`project_id`, `status`). Se a migration real do engine
 * (`apps/engine/priv/repo/migrations/20260724124356_create_dev_agent_states.exs`)
 * mudar o nome/tipo dessas duas colunas, este fixture precisa acompanhar —
 * é o preço declarado da decisão de ler a tabela do engine direto em vez de
 * por HTTP interno (ADR 0097).
 */
async function ensureEngineFixture(pool: Pool) {
  await pool.query('CREATE SCHEMA IF NOT EXISTS engine');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS engine.dev_agent_states (
      project_id text NOT NULL,
      agent_id text NOT NULL,
      status text NOT NULL DEFAULT 'working',
      PRIMARY KEY (project_id, agent_id)
    )
  `);
}
