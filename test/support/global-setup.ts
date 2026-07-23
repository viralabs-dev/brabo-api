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
  await pool.end();
}
