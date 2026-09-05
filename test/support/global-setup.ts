import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import {
  LEGACY_DATABASE_NAME,
  MAX_WORKER_DATABASES,
  TEMPLATE_DATABASE_NAME,
  TEMPLATE_DATABASE_URL,
  workerDatabaseName,
} from './test-db-name';

// Banco de dev (mesmo do docker-compose) — só serve de onde rodar
// CREATE/DROP DATABASE; nenhum teste escreve nele.
const ADMIN_DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://brabo:brabo@localhost:5432/brabo';

const DUPLICATE_DATABASE = '42P04';

export default async function setup() {
  const adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
  try {
    // BANCO POR WORKER (perf/banco-por-worker-nos-testes-da-api): antes,
    // `fileParallelism: false` serializava ~80 arquivos de spec porque todos
    // batiam na MESMA `brabo_test` e faziam TRUNCATE entre testes — arquivo
    // em paralelo colidia com arquivo. A saída não é sincronizar o TRUNCATE
    // (isso serializaria de novo, só que mais devagar), é dar a cada worker
    // do Vitest um banco EXCLUSIVO: sem banco compartilhado, não há
    // colisão nenhuma para sincronizar.
    //
    // Migrar o schema do zero é o passo caro (drizzle-orm/migrator, ~50
    // migrations); pagar esse custo `MAX_WORKER_DATABASES` vezes tornaria o
    // globalSetup mais lento que a serialização que ele substitui. Em vez
    // disso, migra-se UMA VEZ um banco TEMPLATE e cada banco de worker nasce
    // de `CREATE DATABASE ... TEMPLATE` — cópia de PÁGINA do Postgres, não
    // um replay de migration, então é barata mesmo criando várias.
    //
    // Determinístico e não incremental: dropamos e recriamos o template e
    // todos os bancos de worker A CADA execução. Reaproveitar entre
    // execuções economizaria alguns segundos, mas esconderia uma migration
    // nova atrás de um schema velho que sobrou de uma rodada anterior na
    // máquina do dev — o mesmo motivo por que CI sempre sobe Postgres vazio.
    await recreateDatabase(adminPool, TEMPLATE_DATABASE_NAME);
    await migrateAndSeed(TEMPLATE_DATABASE_URL);

    // `LEGACY_DATABASE_NAME` (`brabo_test`) não é usado pelo fluxo normal —
    // nenhum spec conecta nele quando `VITEST_POOL_ID` está presente. Ele
    // existe só para o fallback de `resolveDatabaseUrlForCurrentWorker()`
    // (spec avulso fora do Vitest, ambiente antigo): manter esse banco de pé
    // é o que faz esse fallback ser um banco de verdade, não um nome que
    // aponta pro vazio.
    await recreateDatabase(
      adminPool,
      LEGACY_DATABASE_NAME,
      TEMPLATE_DATABASE_NAME,
    );

    // Número FIXO (ver comentário em `test-db-name.ts`): criar os
    // `MAX_WORKER_DATABASES` aqui, sob demanda seria mais "sob medida" mas
    // introduziria uma corrida entre workers pedindo o MESMO banco ao mesmo
    // tempo — dois `CREATE DATABASE ... TEMPLATE` concorrentes sobre o
    // mesmo template colidem (o Postgres recusa o segundo enquanto o
    // primeiro copia). Criar todos aqui, sequencialmente, antes de qualquer
    // worker pedir banco, elimina essa corrida de forma simples.
    for (let workerId = 1; workerId <= MAX_WORKER_DATABASES; workerId += 1) {
      await recreateDatabase(
        adminPool,
        workerDatabaseName(workerId),
        TEMPLATE_DATABASE_NAME,
      );
    }
  } finally {
    await adminPool.end();
  }
}

/**
 * Recria `name` do zero. Sem `template`, é um `CREATE DATABASE` comum (usado
 * só para o próprio banco template, que ainda não tem de onde copiar). Com
 * `template`, clona por cópia de página.
 *
 * `CREATE DATABASE ... TEMPLATE` falha se o template tiver conexões abertas
 * no momento da cópia — por isso `migrateAndSeed` abre uma conexão PRÓPRIA
 * pro template e a FECHA (`pool.end()`) antes de qualquer clone, em vez de
 * reaproveitar `adminPool` pra migrar.
 */
async function recreateDatabase(
  adminPool: Pool,
  name: string,
  template?: string,
) {
  // Encerra conexões residuais antes do DROP — se uma execução anterior
  // travou/crashou sem fechar o pool (Ctrl+C no meio da suite), o DROP
  // recusa com "database is being accessed by other users" e o setup para
  // de funcionar sozinho na próxima tentativa.
  await adminPool.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    [name],
  );
  await adminPool.query(`DROP DATABASE IF EXISTS "${name}"`);

  try {
    const templateClause = template ? ` TEMPLATE "${template}"` : '';
    await adminPool.query(`CREATE DATABASE "${name}"${templateClause}`);
  } catch (error) {
    // Corrida residual (dois processos de teste subindo ao mesmo tempo na
    // mesma máquina) — o DROP acima não garante exclusividade entre o DROP
    // e o CREATE. Não é o caminho esperado, mas não é fatal: o banco já
    // existe com o schema certo de qualquer forma.
    if ((error as { code?: string }).code !== DUPLICATE_DATABASE) throw error;
  }
}

async function migrateAndSeed(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  await ensureEngineFixture(pool);
  await pool.end();
}

/**
 * `engine.dev_agent_states` (RN-409) — tabela do ENGINE (Ecto, prefix
 * "engine"), não da api. Migrada só no banco TEMPLATE; cada banco de worker
 * a herda pela cópia de `CREATE DATABASE ... TEMPLATE`, junto com o resto do
 * schema do Drizzle. As migrations do engine (`mix ecto.migrate`) não rodam
 * neste job (sem Elixir no `test-api` do CI). Sem isto,
 * `DrizzleProjectsSummaryRepository` — que lê esta tabela via SQL cru (mesmo
 * caminho de `engine.oban_peers` em `medir-execucao.ts`) — falharia com
 * "relation does not exist" em TODO teste que chama `summarizeForWorkspace`.
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
