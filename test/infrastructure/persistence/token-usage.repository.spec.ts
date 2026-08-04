import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../../support/test-db';
import {
  models,
  projects,
  sessions,
  tokenUsage,
  users,
  workspaces,
} from '../../../src/db/schema';
import { DrizzleTokenUsageRepository } from '../../../src/infrastructure/persistence/drizzle/token-usage.repository';

const { db, pool } = createTestDb();
const repo = new DrizzleTokenUsageRepository(db);

async function seed(): Promise<{
  projectId: string;
  sessionId: string;
  modelId: string;
}> {
  const [owner] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-tu', email: 'tu@brabo.dev' })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: owner.id })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: ws.id,
      name: 'core',
      slug: 'core',
      createdBy: owner.id,
    })
    .returning();
  const [session] = await db
    .insert(sessions)
    .values({ projectId: project.id, createdBy: owner.id })
    .returning();
  const [model] = await db
    .insert(models)
    .values({
      provider: 'ollama',
      name: 'qwen2.5-coder:7b',
      displayName: 'Qwen Coder 7B',
    })
    .returning();
  return { projectId: project.id, sessionId: session.id, modelId: model.id };
}

async function record(
  sessionId: string,
  modelId: string,
  actorId: string,
  costMicros: number,
) {
  await repo.record({
    sessionId,
    actor: { kind: 'agent', id: actorId },
    provider: 'ollama',
    modelId,
    modelName: 'qwen2.5-coder:7b',
    inputTokens: 10,
    outputTokens: 5,
    estimated: false,
    costMicros,
    latencyMs: 1,
    bindingOrigin: 'project',
  });
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('DrizzleTokenUsageRepository.sumBySessionGroupedByActor (Fase 4a)', () => {
  it('agrupa custo e tokens por agente', async () => {
    // É o que alimenta os "tokens da sessão" de cada AgentCard no painel —
    // antes não havia agregação nem rota, só o total do budget (ADR 0021).
    const { sessionId, modelId } = await seed();
    await record(sessionId, modelId, 'dev-core', 100);
    await record(sessionId, modelId, 'dev-core', 250);
    await record(sessionId, modelId, 'qa', 70);

    const linhas = await repo.sumBySessionGroupedByActor(sessionId);
    const porAgente = Object.fromEntries(linhas.map((l) => [l.actorId, l]));

    expect(porAgente['dev-core'].costMicros).toBe(350);
    expect(porAgente['dev-core'].inputTokens).toBe(20);
    expect(porAgente['dev-core'].outputTokens).toBe(10);
    expect(porAgente['qa'].costMicros).toBe(70);
  });

  it('sessão sem consumo devolve lista vazia, não erro', async () => {
    const { sessionId } = await seed();
    expect(await repo.sumBySessionGroupedByActor(sessionId)).toEqual([]);
  });
});

describe('DrizzleTokenUsageRepository.sumByProjectGroupedByAgentLast30Days', () => {
  it('agrupa por agente somando as sessões do projeto', async () => {
    const { projectId, sessionId, modelId } = await seed();
    await record(sessionId, modelId, 'dev-core', 100);
    await record(sessionId, modelId, 'dev-core', 250);
    await record(sessionId, modelId, 'qa', 70);

    const linhas = await repo.sumByProjectGroupedByAgentLast30Days(projectId);
    const porAgente = Object.fromEntries(linhas.map((l) => [l.actorId, l]));

    expect(porAgente['dev-core'].costMicros).toBe(350);
    expect(porAgente['qa'].costMicros).toBe(70);
  });

  /**
   * A janela é DESLIZANTE, e este teste é o que impede alguém de trocá-la por
   * `date_trunc('month')` "para bater com o outro método": no dia 1º a
   * estimativa da tela despencaria por virada de página, não por mudança de
   * uso — e o rótulo do desenho diz "últimos 30 dias".
   */
  it('exclui consumo mais velho que 30 dias', async () => {
    const { projectId, sessionId, modelId } = await seed();
    await record(sessionId, modelId, 'dev-core', 100);

    // 31 dias atrás: fora da janela.
    await db
      .update(tokenUsage)
      .set({ createdAt: sql`now() - interval '31 days'` })
      .where(eq(tokenUsage.actorId, 'dev-core'));
    await record(sessionId, modelId, 'dev-core', 40);

    const [linha] = await repo.sumByProjectGroupedByAgentLast30Days(projectId);
    expect(linha.costMicros).toBe(40);
  });

  /**
   * RN-038: sem o filtro de `actor_kind`, um usuário conversando no chat
   * entraria na conta de um agente cujo nome ele nem carrega.
   */
  it('ignora consumo que não é de agente', async () => {
    const { projectId, sessionId, modelId } = await seed();
    await repo.record({
      sessionId,
      actor: { kind: 'user', id: 'alguem' },
      provider: 'ollama',
      modelId,
      modelName: 'qwen2.5-coder:7b',
      inputTokens: 10,
      outputTokens: 5,
      estimated: false,
      costMicros: 999,
      latencyMs: 1,
      bindingOrigin: 'project',
    });

    expect(await repo.sumByProjectGroupedByAgentLast30Days(projectId)).toEqual(
      [],
    );
  });

  it('projeto sem consumo devolve lista vazia', async () => {
    const { projectId } = await seed();
    expect(await repo.sumByProjectGroupedByAgentLast30Days(projectId)).toEqual(
      [],
    );
  });
});
