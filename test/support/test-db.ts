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
      budgets, token_usage, user_credentials, model_bindings,
      model_price_changes, models,
      outbox_events, agent_autonomy, proposed_actions, project_git_connections,
      repo_bootstraps, project_repositories, tasks, stories, epics, module_maps,
      handoffs, agent_instructions, chunks,
      session_socket_tickets, session_events, sessions,
      auth_credentials, refresh_tokens, account_tokens,
      auth_events, auth_lockout_hits,
      project_members, projects, workspace_members, workspaces, users
    RESTART IDENTITY CASCADE
  `);
}
