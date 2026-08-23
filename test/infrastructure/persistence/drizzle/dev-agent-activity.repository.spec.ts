import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { projects, users, workspaces } from '../../../../src/db/schema';
import { DrizzleDevAgentActivityRepository } from '../../../../src/infrastructure/persistence/drizzle/dev-agent-activity.repository';

const { db, pool } = createTestDb();
const repo = new DrizzleDevAgentActivityRepository(db);

async function criarUsuario(email: string) {
  const [row] = await db
    .insert(users)
    .values({ keycloakSub: `sub-${email}`, email, name: email })
    .returning();
  return row;
}

async function criarWorkspace(ownerId: string, slug: string) {
  const [row] = await db
    .insert(workspaces)
    .values({ name: slug, slug, createdBy: ownerId })
    .returning();
  return row;
}

async function criarProjeto(
  workspaceId: string,
  ownerId: string,
  slug: string,
) {
  const [row] = await db
    .insert(projects)
    .values({ workspaceId, name: slug, slug, createdBy: ownerId })
    .returning();
  return row;
}

// RN-409/RN-447 — `engine.dev_agent_states` não é tabela do Drizzle (schema
// "engine"); a fixture criada pelo globalSetup (`ensureEngineFixture`) só
// tem as duas colunas que a consulta lê.
async function criarDevAgentState(
  projectId: string,
  agentId: string,
  status: string,
) {
  await db.execute(sql`
    insert into engine.dev_agent_states (project_id, agent_id, status)
    values (${projectId}, ${agentId}, ${status})
  `);
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('DrizzleDevAgentActivityRepository (RN-447)', () => {
  it('projeto sem nenhuma linha: false', async () => {
    const owner = await criarUsuario('sem-linha@brabo.dev');
    const ws = await criarWorkspace(owner.id, 'sem-linha');
    const projeto = await criarProjeto(ws.id, owner.id, 'core');

    expect(await repo.hasActiveAgents(projeto.id)).toBe(false);
  });

  it('só `idle`: false — é o único status que NÃO conta', async () => {
    const owner = await criarUsuario('so-idle@brabo.dev');
    const ws = await criarWorkspace(owner.id, 'so-idle');
    const projeto = await criarProjeto(ws.id, owner.id, 'core');
    await criarDevAgentState(projeto.id, 'dev-api', 'idle');

    expect(await repo.hasActiveAgents(projeto.id)).toBe(false);
  });

  it('`working`: true', async () => {
    const owner = await criarUsuario('working@brabo.dev');
    const ws = await criarWorkspace(owner.id, 'working');
    const projeto = await criarProjeto(ws.id, owner.id, 'core');
    await criarDevAgentState(projeto.id, 'dev-api', 'working');

    expect(await repo.hasActiveAgents(projeto.id)).toBe(true);
  });

  it('`idle_tripped` (circuit breaker travado): true — precisa de desbloqueio humano', async () => {
    const owner = await criarUsuario('tripped@brabo.dev');
    const ws = await criarWorkspace(owner.id, 'tripped');
    const projeto = await criarProjeto(ws.id, owner.id, 'core');
    await criarDevAgentState(projeto.id, 'dev-api', 'idle_tripped');

    expect(await repo.hasActiveAgents(projeto.id)).toBe(true);
  });

  it('`awaiting_gate`/`awaiting_approval`: true', async () => {
    const owner = await criarUsuario('gate@brabo.dev');
    const ws = await criarWorkspace(owner.id, 'gate');
    const projeto = await criarProjeto(ws.id, owner.id, 'core');
    await criarDevAgentState(projeto.id, 'dev-api', 'awaiting_gate');

    expect(await repo.hasActiveAgents(projeto.id)).toBe(true);
  });

  it('um agente `idle` e outro `working` no mesmo projeto: true — basta UM não-ocioso', async () => {
    const owner = await criarUsuario('misto@brabo.dev');
    const ws = await criarWorkspace(owner.id, 'misto');
    const projeto = await criarProjeto(ws.id, owner.id, 'core');
    await criarDevAgentState(projeto.id, 'dev-api', 'idle');
    await criarDevAgentState(projeto.id, 'dev-web', 'working');

    expect(await repo.hasActiveAgents(projeto.id)).toBe(true);
  });

  it('agente ativo em OUTRO projeto não vaza para este', async () => {
    const owner = await criarUsuario('isolado@brabo.dev');
    const ws = await criarWorkspace(owner.id, 'isolado');
    const projetoA = await criarProjeto(ws.id, owner.id, 'a');
    const projetoB = await criarProjeto(ws.id, owner.id, 'b');
    await criarDevAgentState(projetoB.id, 'dev-api', 'working');

    expect(await repo.hasActiveAgents(projetoA.id)).toBe(false);
    expect(await repo.hasActiveAgents(projetoB.id)).toBe(true);
  });
});
