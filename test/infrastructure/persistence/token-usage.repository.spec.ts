import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, truncateAll } from '../../support/test-db';
import {
  models,
  projects,
  sessions,
  users,
  workspaces,
} from '../../../src/db/schema';
import { DrizzleTokenUsageRepository } from '../../../src/infrastructure/persistence/drizzle/token-usage.repository';

const { db, pool } = createTestDb();
const repo = new DrizzleTokenUsageRepository(db);

async function seed(): Promise<{ sessionId: string; modelId: string }> {
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
  return { sessionId: session.id, modelId: model.id };
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
