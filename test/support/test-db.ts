import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../src/db/schema';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://brabo:brabo@localhost:5432/brabo_test';

export function createTestDb() {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export async function truncateAll(db: ReturnType<typeof drizzle>) {
  await db.execute(sql`
    TRUNCATE TABLE
      budgets, token_usage, user_credentials, model_bindings, models,
      outbox_events, session_events, sessions,
      project_members, projects, workspace_members, workspaces, users
    RESTART IDENTITY CASCADE
  `);
}
