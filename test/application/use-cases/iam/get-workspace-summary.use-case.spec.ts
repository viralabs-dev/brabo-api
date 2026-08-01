import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  projects,
  sessions,
  tokenUsage,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';
import { DrizzleTokenUsageRepository } from '../../../../src/infrastructure/persistence/drizzle/token-usage.repository';
import { GetWorkspaceSummaryUseCase } from '../../../../src/application/use-cases/iam/get-workspace-summary.use-case';

const { db, pool } = createTestDb();
const projectRepo = new DrizzleProjectRepository(db);
const tokenUsageRepo = new DrizzleTokenUsageRepository(db);
const getWorkspaceSummary = new GetWorkspaceSummaryUseCase(
  projectRepo,
  tokenUsageRepo,
);

async function createUser(email: string) {
  const [row] = await db
    .insert(users)
    .values({ keycloakSub: `sub-${email}`, email, name: email })
    .returning();
  return row;
}

async function createWorkspace(ownerId: string, slug: string) {
  const [row] = await db
    .insert(workspaces)
    .values({ name: slug, slug, createdBy: ownerId })
    .returning();
  return row;
}

async function createProject(
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

async function createSession(projectId: string, ownerId: string) {
  const [row] = await db
    .insert(sessions)
    .values({ projectId, createdBy: ownerId })
    .returning();
  return row;
}

async function recordUsage(
  sessionId: string,
  overrides: Partial<typeof tokenUsage.$inferInsert> = {},
) {
  await db.insert(tokenUsage).values({
    sessionId,
    actorKind: 'agent',
    actorId: 'dev-api',
    provider: 'anthropic',
    modelName: 'claude-sonnet-5',
    inputTokens: 100,
    outputTokens: 50,
    estimated: false,
    costMicros: 1_000_000,
    latencyMs: 500,
    bindingOrigin: null,
    ...overrides,
  });
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('GetWorkspaceSummaryUseCase', () => {
  it('workspace sem projetos: zeros, sem erro', async () => {
    const owner = await createUser('owner@brabo.dev');
    const workspace = await createWorkspace(owner.id, 'vazio');

    const result = await getWorkspaceSummary.execute(workspace.id);

    expect(result).toEqual({
      activeProjects: 0,
      agentCount: 0,
      spentMicros: 0,
    });
  });

  it('conta todo projeto do workspace, sem filtro de "ativo"', async () => {
    const owner = await createUser('owner2@brabo.dev');
    const workspace = await createWorkspace(owner.id, 'acme');
    await createProject(workspace.id, owner.id, 'core');
    await createProject(workspace.id, owner.id, 'web');

    const result = await getWorkspaceSummary.execute(workspace.id);

    expect(result.activeProjects).toBe(2);
  });

  it('filtra ator não-agente — user e system não contam como agente', async () => {
    const owner = await createUser('owner3@brabo.dev');
    const workspace = await createWorkspace(owner.id, 'acme3');
    const project = await createProject(workspace.id, owner.id, 'core');
    const session = await createSession(project.id, owner.id);

    await recordUsage(session.id, { actorKind: 'agent', actorId: 'dev-api' });
    await recordUsage(session.id, { actorKind: 'user', actorId: owner.id });
    await recordUsage(session.id, { actorKind: 'system', actorId: 'system' });

    const result = await getWorkspaceSummary.execute(workspace.id);

    expect(result.agentCount).toBe(1);
  });

  it('exclui gasto de mês anterior', async () => {
    const owner = await createUser('owner4@brabo.dev');
    const workspace = await createWorkspace(owner.id, 'acme4');
    const project = await createProject(workspace.id, owner.id, 'core');
    const session = await createSession(project.id, owner.id);

    // `setDate(1)` primeiro evita o estouro de fim de mês do JS Date: em 31
    // de julho, `setMonth(mes - 1)` sem isso cai em "31 de junho", que não
    // existe, e o Date normaliza pra 1º de julho — ainda dentro do mês
    // corrente, e o teste passaria mesmo com o filtro quebrado.
    const mesPassado = new Date();
    mesPassado.setDate(1);
    mesPassado.setMonth(mesPassado.getMonth() - 1);

    await recordUsage(session.id, {
      actorId: 'dev-api',
      costMicros: 5_000_000,
    });
    await recordUsage(session.id, {
      actorId: 'dev-web',
      costMicros: 9_000_000,
      createdAt: mesPassado,
    });

    const result = await getWorkspaceSummary.execute(workspace.id);

    expect(result.agentCount).toBe(1);
    expect(result.spentMicros).toBe(5_000_000);
  });

  it('soma o gasto cruzando múltiplos projetos do mesmo workspace', async () => {
    const owner = await createUser('owner5@brabo.dev');
    const workspace = await createWorkspace(owner.id, 'acme5');
    const projectA = await createProject(workspace.id, owner.id, 'core');
    const projectB = await createProject(workspace.id, owner.id, 'web');
    const sessionA = await createSession(projectA.id, owner.id);
    const sessionB = await createSession(projectB.id, owner.id);

    await recordUsage(sessionA.id, {
      actorId: 'dev-api',
      costMicros: 2_000_000,
    });
    await recordUsage(sessionB.id, {
      actorId: 'dev-web',
      costMicros: 3_000_000,
    });

    const result = await getWorkspaceSummary.execute(workspace.id);

    expect(result.agentCount).toBe(2);
    expect(result.spentMicros).toBe(5_000_000);
  });

  it('não mistura gasto de outro workspace', async () => {
    const owner = await createUser('owner6@brabo.dev');
    const workspaceA = await createWorkspace(owner.id, 'acme6a');
    const workspaceB = await createWorkspace(owner.id, 'acme6b');
    const projectA = await createProject(workspaceA.id, owner.id, 'core');
    const projectB = await createProject(workspaceB.id, owner.id, 'core');
    const sessionA = await createSession(projectA.id, owner.id);
    const sessionB = await createSession(projectB.id, owner.id);

    await recordUsage(sessionA.id, {
      actorId: 'dev-api',
      costMicros: 1_000_000,
    });
    await recordUsage(sessionB.id, {
      actorId: 'dev-outro',
      costMicros: 7_000_000,
    });

    const result = await getWorkspaceSummary.execute(workspaceA.id);

    expect(result.agentCount).toBe(1);
    expect(result.spentMicros).toBe(1_000_000);
  });
});
