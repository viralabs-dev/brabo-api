import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { projects, users, workspaces } from '../../../../src/db/schema';
import { AGENT_AUTONOMY_ALL_ACTIONS } from '../../../../src/domain/actions/decide';
import { DrizzleAgentAutonomyRepository } from '../../../../src/infrastructure/persistence/drizzle/agent-autonomy.repository';

const { db, pool } = createTestDb();
const repo = new DrizzleAgentAutonomyRepository(db);

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

async function criarProjeto() {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-agent-autonomy', email: 'agent-autonomy@brabo.dev' })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: user.id })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({ workspaceId: workspace.id, name: 'core', slug: 'core', createdBy: user.id })
    .returning();
  return project;
}

describe('DrizzleAgentAutonomyRepository — precedência do curinga (RN-153)', () => {
  it('sem regra nenhuma, findMode devolve null', async () => {
    const project = await criarProjeto();
    const mode = await repo.findMode(project.id, 'dev-api', 'terminal');
    expect(mode).toBeNull();
  });

  it('só a curinga (auto mode) resolve pra qualquer actionType pedido', async () => {
    const project = await criarProjeto();
    await repo.upsert(project.id, 'dev-api', AGENT_AUTONOMY_ALL_ACTIONS, 'auto_approve');

    expect(await repo.findMode(project.id, 'dev-api', 'terminal')).toBe('auto_approve');
    expect(await repo.findMode(project.id, 'dev-api', 'write_file')).toBe('auto_approve');
    expect(await repo.findMode(project.id, 'dev-api', 'pr_open')).toBe('auto_approve');
  });

  it('regra ESPECÍFICA vence a curinga — "auto mode ligado, mas terminal em deny" funciona', async () => {
    const project = await criarProjeto();
    await repo.upsert(project.id, 'dev-api', AGENT_AUTONOMY_ALL_ACTIONS, 'auto_approve');
    await repo.upsert(project.id, 'dev-api', 'terminal', 'deny');

    expect(await repo.findMode(project.id, 'dev-api', 'terminal')).toBe('deny');
    // O resto continua herdando da curinga.
    expect(await repo.findMode(project.id, 'dev-api', 'write_file')).toBe('auto_approve');
  });

  it('a curinga é por agente: outro agente sem regra continua null', async () => {
    const project = await criarProjeto();
    await repo.upsert(project.id, 'dev-api', AGENT_AUTONOMY_ALL_ACTIONS, 'auto_approve');

    expect(await repo.findMode(project.id, 'dev-web', 'terminal')).toBeNull();
  });

  it('desligar: gravar a curinga como require_approval por cima some com o auto mode', async () => {
    const project = await criarProjeto();
    await repo.upsert(project.id, 'dev-api', AGENT_AUTONOMY_ALL_ACTIONS, 'auto_approve');
    await repo.upsert(project.id, 'dev-api', AGENT_AUTONOMY_ALL_ACTIONS, 'require_approval');

    expect(await repo.findMode(project.id, 'dev-api', 'terminal')).toBe('require_approval');
  });

  it('listForProject devolve a linha curinga como qualquer outra', async () => {
    const project = await criarProjeto();
    await repo.upsert(project.id, 'dev-api', AGENT_AUTONOMY_ALL_ACTIONS, 'auto_approve');

    const rows = await repo.listForProject(project.id);
    expect(rows).toEqual([
      { agentId: 'dev-api', actionType: AGENT_AUTONOMY_ALL_ACTIONS, mode: 'auto_approve' },
    ]);
  });
});
