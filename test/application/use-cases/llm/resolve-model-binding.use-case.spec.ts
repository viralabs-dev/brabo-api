import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  models,
  projects,
  sessions,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleModelBindingRepository } from '../../../../src/infrastructure/persistence/drizzle/model-binding.repository';
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';
import { ResolveModelBindingUseCase } from '../../../../src/application/use-cases/llm/resolve-model-binding.use-case';

const { db, pool } = createTestDb();
const bindingRepo = new DrizzleModelBindingRepository(db);
const projectRepo = new DrizzleProjectRepository(db);
const resolveModelBinding = new ResolveModelBindingUseCase(
  bindingRepo,
  projectRepo,
);

async function setup() {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-binding', email: 'binding@brabo.dev' })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: user.id })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: 'core',
      slug: 'core',
      createdBy: user.id,
    })
    .returning();
  const [session] = await db
    .insert(sessions)
    .values({ projectId: project.id, createdBy: user.id })
    .returning();
  const [modelA] = await db
    .insert(models)
    .values({ provider: 'ollama', name: 'model-a', displayName: 'A' })
    .returning();
  const [modelB] = await db
    .insert(models)
    .values({ provider: 'ollama', name: 'model-b', displayName: 'B' })
    .returning();
  return { user, workspace, project, session, modelA, modelB };
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('ResolveModelBindingUseCase', () => {
  it('caminho feliz: cascata integrada — sessão sobrepõe workspace', async () => {
    const { user, workspace, project, session, modelA, modelB } = await setup();

    await bindingRepo.upsert({
      scope: 'workspace',
      scopeId: workspace.id,
      modelId: modelA.id,
      createdBy: user.id,
    });
    await bindingRepo.upsert({
      scope: 'session',
      scopeId: session.id,
      modelId: modelB.id,
      createdBy: user.id,
    });

    const resolved = await resolveModelBinding.execute({
      projectId: project.id,
      sessionId: session.id,
    });

    expect(resolved).toEqual({ modelId: modelB.id, origin: 'session' });
  });

  it('sem binding de sessão, cai pro workspace via o projeto', async () => {
    const { user, workspace, project, session, modelA } = await setup();

    await bindingRepo.upsert({
      scope: 'workspace',
      scopeId: workspace.id,
      modelId: modelA.id,
      createdBy: user.id,
    });

    const resolved = await resolveModelBinding.execute({
      projectId: project.id,
      sessionId: session.id,
    });

    expect(resolved).toEqual({ modelId: modelA.id, origin: 'workspace' });
  });

  it('falha: projeto inexistente retorna null (não lança)', async () => {
    const resolved = await resolveModelBinding.execute({
      projectId: '00000000-0000-0000-0000-000000000000',
      sessionId: '00000000-0000-0000-0000-000000000000',
    });
    expect(resolved).toBeNull();
  });

  it('sem nenhum binding configurado, retorna null', async () => {
    const { project, session } = await setup();
    const resolved = await resolveModelBinding.execute({
      projectId: project.id,
      sessionId: session.id,
    });
    expect(resolved).toBeNull();
  });
});
