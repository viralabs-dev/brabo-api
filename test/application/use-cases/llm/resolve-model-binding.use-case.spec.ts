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
import {
  chaveDeAgente,
  chaveDeArea,
} from '../../../../src/domain/llm/binding-scope-id';

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
      scopeId: chaveDeAgente(project.id, 'qa'),
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

  it('modelo do agente indisponível: a cascata assume o workspace e avisa (RN-043)', async () => {
    const { user, workspace, project, modelA, modelB } = await setup();

    await bindingRepo.upsert({
      scope: 'workspace',
      scopeId: workspace.id,
      modelId: modelA.id,
      createdBy: user.id,
    });
    await bindingRepo.upsert({
      scope: 'agent',
      scopeId: chaveDeAgente(project.id, 'qa'),
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
      scopeId: chaveDeAgente(project.id, 'qa'),
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

  // ------------------------------------------------ FASE 23 / ADR 0064
  // O padrão herdável da área, e a consequência de o binding de agente ter
  // deixado de ser global.

  it('o LEAD e o SUBAGENTE da mesma área herdam o mesmo modelo (RN-102)', async () => {
    const { user, workspace, project, modelA, modelB } = await setup();

    await bindingRepo.upsert({
      scope: 'workspace',
      scopeId: workspace.id,
      modelId: modelA.id,
      createdBy: user.id,
    });
    await bindingRepo.upsert({
      scope: 'area',
      scopeId: chaveDeArea(project.id, 'qa'),
      modelId: modelB.id,
      createdBy: user.id,
    });

    // `qa` é o lead e `qa-automacao` é membro — a área sai do catálogo, sem
    // consultar `agent_areas`.
    for (const agentId of ['qa', 'qa-automacao']) {
      expect(
        await resolveModelBinding.execute({ projectId: project.id, agentId }),
      ).toEqual({ modelId: modelB.id, origin: 'area', skipped: [] });
    }
  });

  it('a área DINÂMICA de dev também herda: `dev-api` cai no predicado', async () => {
    const { user, project, modelB } = await setup();

    await bindingRepo.upsert({
      scope: 'area',
      scopeId: chaveDeArea(project.id, 'dev'),
      modelId: modelB.id,
      createdBy: user.id,
    });

    expect(
      await resolveModelBinding.execute({
        projectId: project.id,
        agentId: 'dev-api',
      }),
    ).toEqual({ modelId: modelB.id, origin: 'area', skipped: [] });
  });

  it('o agente que DIVERGIU vence o padrão da área (RN-102)', async () => {
    const { user, project, modelA, modelB } = await setup();

    await bindingRepo.upsert({
      scope: 'area',
      scopeId: chaveDeArea(project.id, 'qa'),
      modelId: modelA.id,
      createdBy: user.id,
    });
    await bindingRepo.upsert({
      scope: 'agent',
      scopeId: chaveDeAgente(project.id, 'qa-automacao'),
      modelId: modelB.id,
      createdBy: user.id,
    });

    // O que divergiu diverge; o lead ao lado continua herdando.
    expect(
      await resolveModelBinding.execute({
        projectId: project.id,
        agentId: 'qa-automacao',
      }),
    ).toEqual({ modelId: modelB.id, origin: 'agent', skipped: [] });
    expect(
      await resolveModelBinding.execute({
        projectId: project.id,
        agentId: 'qa',
      }),
    ).toEqual({ modelId: modelA.id, origin: 'area', skipped: [] });
  });

  it('pergunta pela ÁREA em si, sem agente nenhum', async () => {
    const { user, project, modelB } = await setup();

    await bindingRepo.upsert({
      scope: 'area',
      scopeId: chaveDeArea(project.id, 'infra'),
      modelId: modelB.id,
      createdBy: user.id,
    });

    expect(
      await resolveModelBinding.execute({
        projectId: project.id,
        areaKey: 'infra',
      }),
    ).toEqual({ modelId: modelB.id, origin: 'area', skipped: [] });
  });

  it('agente SEM área nenhuma ignora o nível: o Criativo cai no projeto', async () => {
    const { user, project, modelA, modelB } = await setup();

    await bindingRepo.upsert({
      scope: 'project',
      scopeId: project.id,
      modelId: modelA.id,
      createdBy: user.id,
    });
    // Existe um padrão de área de QA, e ele NÃO pode alcançar o Criativo.
    await bindingRepo.upsert({
      scope: 'area',
      scopeId: chaveDeArea(project.id, 'qa'),
      modelId: modelB.id,
      createdBy: user.id,
    });

    expect(
      await resolveModelBinding.execute({
        projectId: project.id,
        agentId: 'criativo',
      }),
    ).toEqual({ modelId: modelA.id, origin: 'project', skipped: [] });
  });

  it('o binding de agente é POR PROJETO: o vizinho não o enxerga (RN-103)', async () => {
    const { user, workspace, project, modelA, modelB } = await setup();
    const [vizinho] = await db
      .insert(projects)
      .values({
        workspaceId: workspace.id,
        name: 'loja',
        slug: 'loja',
        createdBy: user.id,
      })
      .returning();

    await bindingRepo.upsert({
      scope: 'workspace',
      scopeId: workspace.id,
      modelId: modelA.id,
      createdBy: user.id,
    });
    await bindingRepo.upsert({
      scope: 'agent',
      scopeId: chaveDeAgente(project.id, 'arquiteto'),
      modelId: modelB.id,
      createdBy: user.id,
    });

    // Era exatamente isto que não valia antes do ADR 0064: escolher o modelo do
    // Arquiteto aqui mudava o modelo dele em TODOS os projetos.
    expect(
      await resolveModelBinding.execute({
        projectId: project.id,
        agentId: 'arquiteto',
      }),
    ).toMatchObject({ modelId: modelB.id, origin: 'agent' });
    expect(
      await resolveModelBinding.execute({
        projectId: vizinho.id,
        agentId: 'arquiteto',
      }),
    ).toMatchObject({ modelId: modelA.id, origin: 'workspace' });
  });

  it('a herança do Criativo também é do PROJETO, não do slug global', async () => {
    const { user, workspace, project, modelA, modelB } = await setup();
    const [vizinho] = await db
      .insert(projects)
      .values({
        workspaceId: workspace.id,
        name: 'loja',
        slug: 'loja',
        createdBy: user.id,
      })
      .returning();

    await bindingRepo.upsert({
      scope: 'workspace',
      scopeId: workspace.id,
      modelId: modelA.id,
      createdBy: user.id,
    });
    await bindingRepo.upsert({
      scope: 'agent',
      scopeId: chaveDeAgente(project.id, 'criativo'),
      modelId: modelB.id,
      createdBy: user.id,
    });

    // Aqui o Criativo decidiu, e o dev agent herda dele (RN-057).
    expect(
      await resolveModelBinding.execute({
        projectId: project.id,
        agentId: 'dev-api',
      }),
    ).toMatchObject({ modelId: modelB.id, origin: 'agent' });
    // No vizinho ninguém decidiu nada: fica o default do workspace.
    expect(
      await resolveModelBinding.execute({
        projectId: vizinho.id,
        agentId: 'dev-api',
      }),
    ).toMatchObject({ modelId: modelA.id, origin: 'workspace' });
  });

  // ------------------------------------------------ item 1 do achado da
  // topbar (bugfix/sessao-chat-consistencia): sem `agentId`, a rota de
  // model-binding da SESSÃO só enxergava sessão→projeto→workspace — com o
  // fallback fixo pro Criativo (`herdarModeloDeStart`) quando o workspace era
  // tudo que sobrava. Depois de um handoff pro PO/Arquiteto/Dev Lead, a
  // topbar continuava mostrando o modelo do Criativo, nunca o do agente
  // REALMENTE ativo. `agentId` roda a cascata completa
  // (sessão→agente→área→projeto→workspace) pro agente certo.

  it('sessão + agentId do PO ativo: resolve pro binding do PO, não pro fallback do Criativo', async () => {
    const { user, workspace, project, session, modelA, modelB } = await setup();
    const [modelC] = await db
      .insert(models)
      .values({ provider: 'ollama', name: 'model-c', displayName: 'C' })
      .returning();

    await bindingRepo.upsert({
      scope: 'workspace',
      scopeId: workspace.id,
      modelId: modelA.id,
      createdBy: user.id,
    });
    // O Criativo divergiu — é o que o fallback usaria SEM `agentId`.
    await bindingRepo.upsert({
      scope: 'agent',
      scopeId: chaveDeAgente(project.id, 'criativo'),
      modelId: modelB.id,
      createdBy: user.id,
    });
    // O PO, que é quem está realmente ativo depois do handoff, tem o
    // binding dele PRÓPRIO.
    await bindingRepo.upsert({
      scope: 'agent',
      scopeId: chaveDeAgente(project.id, 'po'),
      modelId: modelC.id,
      createdBy: user.id,
    });

    // Sem `agentId` (o que a rota fazia antes da correção): cai no fallback
    // do Criativo.
    expect(
      await resolveModelBinding.execute({ projectId: project.id, sessionId: session.id }),
    ).toMatchObject({ modelId: modelB.id, origin: 'agent' });

    // Com `agentId: 'po'` (a correção): resolve pro modelo do PO.
    expect(
      await resolveModelBinding.execute({
        projectId: project.id,
        sessionId: session.id,
        agentId: 'po',
      }),
    ).toMatchObject({ modelId: modelC.id, origin: 'agent' });
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
