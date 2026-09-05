import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../src/db/schema';
import { resolveDatabaseUrlForCurrentWorker } from './test-db-name';

// ASSINATURA pública inalterada de propósito — ~80 specs importam
// `createTestDb`/`truncateAll` de caminhos relativos variados
// (`../../../support/test-db`, `../../support/test-db`, ...) e nenhum deles
// deveria precisar saber que o banco por trás mudou de "um só" para "um por
// worker" (RN da perf/banco-por-worker-nos-testes-da-api). A mudança inteira
// mora em `resolveDatabaseUrlForCurrentWorker()` (test-db-name.ts).
export function createTestDb() {
  const pool = new Pool({
    connectionString: resolveDatabaseUrlForCurrentWorker(),
  });
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
      handoffs, agent_instructions, chunks, project_containers,
      huggingface_model_pull_requests,
      session_socket_tickets, session_events, sessions,
      auth_credentials, refresh_tokens, account_tokens,
      auth_events, auth_lockout_hits,
      project_members, projects, workspace_members, workspaces, users,
      engine.dev_agent_states
    RESTART IDENTITY CASCADE
  `);
}
