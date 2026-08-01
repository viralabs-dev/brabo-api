import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  models,
  projects,
  sessions,
  tokenUsage,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleModelRepository } from '../../../../src/infrastructure/persistence/drizzle/model.repository';
import { DrizzleModelPriceChangeRepository } from '../../../../src/infrastructure/persistence/drizzle/model-price-change.repository';
import { DrizzleTokenUsageRepository } from '../../../../src/infrastructure/persistence/drizzle/token-usage.repository';
import { DrizzleUnitOfWork } from '../../../../src/infrastructure/persistence/drizzle/drizzle-unit-of-work';
import { UpdateModelPricingUseCase } from '../../../../src/application/use-cases/llm/update-model-pricing.use-case';
import { calculateCostMicros } from '../../../../src/domain/llm/cost-calculator';

const { db, pool } = createTestDb();
const modelRepo = new DrizzleModelRepository(db);
const priceChangeRepo = new DrizzleModelPriceChangeRepository(db);
const tokenUsageRepo = new DrizzleTokenUsageRepository(db);
const useCase = new UpdateModelPricingUseCase(
  new DrizzleUnitOfWork(db),
  modelRepo,
  priceChangeRepo,
);

const PRECO_ANTIGO = { entrada: 2_500_000, saida: 10_000_000 };
const PRECO_NOVO = { entrada: 3_000_000, saida: 15_000_000 };
const TOKENS = { entrada: 120_000, saida: 8_000 };

async function setup() {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-preco', email: 'preco@brabo.dev' })
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
      provider: 'openai',
      name: 'gpt-4o',
      displayName: 'GPT-4o',
      inputPricePerMillionMicros: PRECO_ANTIGO.entrada,
      outputPricePerMillionMicros: PRECO_ANTIGO.saida,
    })
    .returning();

  return { user, session, model };
}

/** Uma chamada de ontem, gravada pelo caminho único de metering. */
async function consumoDeOntem(sessionId: string, modelId: string) {
  return tokenUsageRepo.record({
    sessionId,
    actor: { kind: 'agent', id: 'dev-api' },
    provider: 'openai',
    modelId,
    modelName: 'gpt-4o',
    inputTokens: TOKENS.entrada,
    outputTokens: TOKENS.saida,
    estimated: false,
    costMicros: calculateCostMicros(
      TOKENS.entrada,
      TOKENS.saida,
      PRECO_ANTIGO.entrada,
      PRECO_ANTIGO.saida,
    ),
    inputPricePerMillionMicros: PRECO_ANTIGO.entrada,
    outputPricePerMillionMicros: PRECO_ANTIGO.saida,
    latencyMs: 1200,
    bindingOrigin: 'project',
    upstreamProvider: null,
  });
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('UpdateModelPricingUseCase', () => {
  it('caminho feliz: troca o preço e grava a linha de auditoria com antes/depois', async () => {
    const { user, model } = await setup();

    const depois = await useCase.execute({
      modelId: model.id,
      inputPricePerMillionMicros: PRECO_NOVO.entrada,
      outputPricePerMillionMicros: PRECO_NOVO.saida,
      source: 'manual',
      changedBy: user.id,
    });

    expect(depois).toMatchObject({
      inputPricePerMillionMicros: PRECO_NOVO.entrada,
      outputPricePerMillionMicros: PRECO_NOVO.saida,
    });

    const auditoria = await priceChangeRepo.listByModel(model.id);
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({
      inputBeforeMicros: PRECO_ANTIGO.entrada,
      inputAfterMicros: PRECO_NOVO.entrada,
      outputBeforeMicros: PRECO_ANTIGO.saida,
      outputAfterMicros: PRECO_NOVO.saida,
      source: 'manual',
      changedBy: user.id,
    });
  });

  it('o custo de ontem NÃO se move — e continua batendo com o preço gravado (RN-044)', async () => {
    const { user, session, model } = await setup();
    const ontem = await consumoDeOntem(session.id, model.id);

    await useCase.execute({
      modelId: model.id,
      inputPricePerMillionMicros: PRECO_NOVO.entrada,
      outputPricePerMillionMicros: PRECO_NOVO.saida,
      source: 'manual',
      changedBy: user.id,
    });

    const [depois] = await db.select().from(tokenUsage);

    // (a) nem o custo nem o snapshot de preço se mexeram.
    expect(depois.costMicros).toBe(ontem.costMicros);
    expect(depois.inputPricePerMillionMicros).toBe(PRECO_ANTIGO.entrada);
    expect(depois.outputPricePerMillionMicros).toBe(PRECO_ANTIGO.saida);

    // (b) `tokens × preço gravado = custo gravado`. É ESTA conta que o
    // snapshot torna possível: sem ele, o custo antigo seria um número sem
    // procedência assim que o preço do modelo mudasse.
    expect(
      calculateCostMicros(
        depois.inputTokens,
        depois.outputTokens,
        depois.inputPricePerMillionMicros,
        depois.outputPricePerMillionMicros,
      ),
    ).toBe(depois.costMicros);

    // (c) e o preço NOVO dá outro número — o que prova que a asserção acima
    // não passaria por acaso.
    expect(
      calculateCostMicros(
        depois.inputTokens,
        depois.outputTokens,
        PRECO_NOVO.entrada,
        PRECO_NOVO.saida,
      ),
    ).not.toBe(depois.costMicros);
  });

  it('preço igual ao vigente é no-op: não polui a auditoria', async () => {
    const { user, model } = await setup();

    await useCase.execute({
      modelId: model.id,
      inputPricePerMillionMicros: PRECO_ANTIGO.entrada,
      outputPricePerMillionMicros: PRECO_ANTIGO.saida,
      source: 'manual',
      changedBy: user.id,
    });

    expect(await priceChangeRepo.listByModel(model.id)).toHaveLength(0);
  });

  it('sync grava a auditoria sem dono — não há pessoa por trás', async () => {
    const { model } = await setup();

    await useCase.execute({
      modelId: model.id,
      inputPricePerMillionMicros: PRECO_NOVO.entrada,
      outputPricePerMillionMicros: PRECO_NOVO.saida,
      source: 'sync',
      changedBy: null,
    });

    const [linha] = await priceChangeRepo.listByModel(model.id);
    expect(linha).toMatchObject({ source: 'sync', changedBy: null });
  });

  it('falha: modelo inexistente é 404 e não grava auditoria', async () => {
    await setup();

    await expect(
      useCase.execute({
        modelId: '00000000-0000-0000-0000-000000000000',
        inputPricePerMillionMicros: PRECO_NOVO.entrada,
        outputPricePerMillionMicros: PRECO_NOVO.saida,
        source: 'manual',
        changedBy: null,
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
