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
import { DrizzleModelRepository } from '../../../../src/infrastructure/persistence/drizzle/model.repository';
import { ResolveModelBindingUseCase } from '../../../../src/application/use-cases/llm/resolve-model-binding.use-case';

const { db, pool } = createTestDb();
const bindingRepo = new DrizzleModelBindingRepository(db);
const projectRepo = new DrizzleProjectRepository(db);
const modelRepo = new DrizzleModelRepository(db);
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

    expect(resolved).toEqual({
      modelId: modelB.id,
      origin: 'session',
      skipped: [],
    });
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

    expect(resolved).toEqual({
      modelId: modelA.id,
      origin: 'workspace',
      skipped: [],
    });
  });

  it('resolve por agente sem sessão — agente sobrepõe workspace', async () => {
    const { user, workspace, project, modelA, modelB } = await setup();

    await bindingRepo.upsert({
      scope: 'workspace',
      scopeId: workspace.id,
      modelId: modelA.id,
      createdBy: user.id,
    });
    await bindingRepo.upsert({
      scope: 'agent',
      scopeId: 'qa',
      modelId: modelB.id,
      createdBy: user.id,
    });

    const resolved = await resolveModelBinding.execute({
      projectId: project.id,
      agentId: 'qa',
    });

    expect(resolved).toEqual({
      modelId: modelB.id,
      origin: 'agent',
      skipped: [],
    });
  });

  it('modelo do agente indisponível: a cascata assume o workspace e avisa (RN-041)', async () => {
    const { user, workspace, project, modelA, modelB } = await setup();

    await bindingRepo.upsert({
      scope: 'workspace',
      scopeId: workspace.id,
      modelId: modelA.id,
      createdBy: user.id,
    });
    await bindingRepo.upsert({
      scope: 'agent',
      scopeId: 'qa',
      modelId: modelB.id,
      createdBy: user.id,
    });

    // O sync deixou de ver o modelo no provider. O binding CONTINUA no banco —
    // deletar o modelo levaria junto o histórico de custo que aponta pra ele.
    await modelRepo.setAvailability([modelB.id], 'unavailable');

    const resolved = await resolveModelBinding.execute({
      projectId: project.id,
      agentId: 'qa',
    });

    expect(resolved).toEqual({
      modelId: modelA.id,
      origin: 'workspace',
      skipped: [{ scope: 'agent', modelId: modelB.id, reason: 'unavailable' }],
    });
  });

  it('modelo do agente chat-only: turno com ferramentas não pousa nele', async () => {
    const { user, workspace, project, modelA, modelB } = await setup();

    await modelRepo.upsertByProviderAndName({
      provider: 'ollama',
      name: 'model-a',
      displayName: 'A',
      inputPricePerMillionMicros: 0,
      outputPricePerMillionMicros: 0,
      supportsToolCalling: true,
    });

    await bindingRepo.upsert({
      scope: 'workspace',
      scopeId: workspace.id,
      modelId: modelA.id,
      createdBy: user.id,
    });
    await bindingRepo.upsert({
      scope: 'agent',
      scopeId: 'qa',
      modelId: modelB.id, // fica com o default `supportsToolCalling: false`
      createdBy: user.id,
    });

    const resolved = await resolveModelBinding.execute({
      projectId: project.id,
      agentId: 'qa',
      exigeToolCalling: true,
    });

    expect(resolved).toEqual({
      modelId: modelA.id,
      origin: 'workspace',
      skipped: [
        { scope: 'agent', modelId: modelB.id, reason: 'sem_tool_calling' },
      ],
    });
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
