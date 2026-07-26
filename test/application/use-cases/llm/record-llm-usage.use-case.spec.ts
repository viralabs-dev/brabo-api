import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  models,
  outboxEvents,
  projects,
  sessions,
  tokenUsage,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleBudgetRepository } from '../../../../src/infrastructure/persistence/drizzle/budget.repository';
import { DrizzleTokenUsageRepository } from '../../../../src/infrastructure/persistence/drizzle/token-usage.repository';
import { DrizzleOutboxRepository } from '../../../../src/infrastructure/persistence/drizzle/outbox.repository';
import { RecordLlmUsageUseCase } from '../../../../src/application/use-cases/llm/record-llm-usage.use-case';
import { BraboMetrics } from '../../../../src/infrastructure/observability/brabo-metrics';

const { db, pool } = createTestDb();
const budgetRepo = new DrizzleBudgetRepository(db);
const tokenUsageRepo = new DrizzleTokenUsageRepository(db);
const outboxRepo = new DrizzleOutboxRepository(db);
const recordLlmUsage = new RecordLlmUsageUseCase(
  tokenUsageRepo,
  budgetRepo,
  outboxRepo,
  // Registry próprio por spec: prom-client é global por default e
  // contadores vazados entre arquivos tornariam as asserções dependentes
  // da ordem de execução.
  new BraboMetrics(),
);

async function setupSessionAndModel() {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-usage', email: 'usage@brabo.dev' })
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
  const [model] = await db
    .insert(models)
    .values({
      provider: 'ollama',
      name: 'llama3.2:1b',
      displayName: 'Llama 3.2 1B',
      inputPricePerMillionMicros: 0,
      outputPricePerMillionMicros: 0,
    })
    .returning();
  return { user, workspace, project, session, model };
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('RecordLlmUsageUseCase', () => {
  it('caminho feliz: grava token_usage com custo calculado', async () => {
    const { project, session, model, user } = await setupSessionAndModel();

    const usage = await recordLlmUsage.execute({
      projectId: project.id,
      sessionId: session.id,
      actor: { kind: 'user', id: user.id },
      provider: 'ollama',
      modelId: model.id,
      modelName: model.name,
      inputTokens: 100,
      outputTokens: 50,
      estimated: false,
      costMicros: 0,
      latencyMs: 120,
      bindingOrigin: 'workspace',
    });

    const [row] = await db
      .select()
      .from(tokenUsage)
      .where(eq(tokenUsage.id, usage.id));
    expect(row.inputTokens).toBe(100);
    expect(row.outputTokens).toBe(50);
    expect(row.estimated).toBe(false);
  });

  it('incrementa o budget do projeto e dispara threshold ao cruzar 70%', async () => {
    const { project, session, model, user } = await setupSessionAndModel();
    const budget = await budgetRepo.upsertForProject(project.id, {
      limitMicros: 1000,
      policy: 'block',
    });

    await recordLlmUsage.execute({
      projectId: project.id,
      sessionId: session.id,
      actor: { kind: 'user', id: user.id },
      provider: 'anthropic',
      modelId: model.id,
      modelName: model.name,
      inputTokens: 1000,
      outputTokens: 0,
      estimated: false,
      costMicros: 700,
      latencyMs: 50,
      bindingOrigin: 'project',
    });

    const updated = await budgetRepo.findForProject(project.id);
    expect(updated?.spentMicros).toBe(700);
    expect(updated?.lastThresholdNotified).toBe(70);

    const events = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, budget.id));
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('budget.threshold_crossed');
    expect(events[0].payload).toMatchObject({
      threshold: 70,
      scope: 'project',
    });
  });

  it('pular direto de 0% pra 100% dispara os três thresholds numa chamada só', async () => {
    const { project, session, model, user } = await setupSessionAndModel();
    await budgetRepo.upsertForProject(project.id, {
      limitMicros: 1000,
      policy: 'block',
    });

    await recordLlmUsage.execute({
      projectId: project.id,
      sessionId: session.id,
      actor: { kind: 'user', id: user.id },
      provider: 'anthropic',
      modelId: model.id,
      modelName: model.name,
      inputTokens: 1000,
      outputTokens: 0,
      estimated: false,
      costMicros: 1000,
      latencyMs: 50,
      bindingOrigin: 'project',
    });

    const updated = await budgetRepo.findForProject(project.id);
    expect(updated?.lastThresholdNotified).toBe(100);

    const events = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, 'budget.threshold_crossed'));
    expect(events).toHaveLength(3);
    expect(
      events
        .map((e) => (e.payload as { threshold: number }).threshold)
        .sort((a, b) => a - b),
    ).toEqual([70, 90, 100]);
  });

  it('não re-dispara um threshold já notificado em chamadas seguintes', async () => {
    const { project, session, model, user } = await setupSessionAndModel();
    await budgetRepo.upsertForProject(project.id, {
      limitMicros: 1000,
      policy: 'block',
    });

    const call = (costMicros: number) =>
      recordLlmUsage.execute({
        projectId: project.id,
        sessionId: session.id,
        actor: { kind: 'user', id: user.id },
        provider: 'anthropic',
        modelId: model.id,
        modelName: model.name,
        inputTokens: 1,
        outputTokens: 0,
        estimated: false,
        costMicros,
        latencyMs: 10,
        bindingOrigin: 'project',
      });

    await call(700); // cruza 70%
    await call(50); // ainda abaixo de 90%, não deveria disparar nada

    const events = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, 'budget.threshold_crossed'));
    expect(events).toHaveLength(1);
  });

  it('seq sem perda sob incremento concorrente de budget (spentMicros correto)', async () => {
    const { project, session, model, user } = await setupSessionAndModel();
    await budgetRepo.upsertForProject(project.id, {
      limitMicros: 1_000_000,
      policy: 'allow',
    });

    const CONCURRENCY = 20;
    const deltaPerCall = 100;

    await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        recordLlmUsage.execute({
          projectId: project.id,
          sessionId: session.id,
          actor: { kind: 'user', id: user.id },
          provider: 'anthropic',
          modelId: model.id,
          modelName: model.name,
          inputTokens: 1,
          outputTokens: 0,
          estimated: false,
          costMicros: deltaPerCall,
          latencyMs: 10,
          bindingOrigin: 'project',
        }),
      ),
    );

    const updated = await budgetRepo.findForProject(project.id);
    expect(updated?.spentMicros).toBe(CONCURRENCY * deltaPerCall);
  });
});
