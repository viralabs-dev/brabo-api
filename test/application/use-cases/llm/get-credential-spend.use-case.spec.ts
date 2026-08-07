import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  models,
  projects,
  sessions,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleTokenUsageRepository } from '../../../../src/infrastructure/persistence/drizzle/token-usage.repository';
import { DrizzleUserCredentialRepository } from '../../../../src/infrastructure/persistence/drizzle/user-credential.repository';
import { DrizzleWorkspaceRepository } from '../../../../src/infrastructure/persistence/drizzle/workspace.repository';
import { EnvelopeEncryptionService } from '../../../../src/infrastructure/security/envelope-encryption.service';
import { GetCredentialSpendUseCase } from '../../../../src/application/use-cases/llm/get-credential-spend.use-case';

const { db, pool } = createTestDb();
const tokenUsageRepo = new DrizzleTokenUsageRepository(db);
const credentialRepo = new DrizzleUserCredentialRepository(db);
const encryption = new EnvelopeEncryptionService();
const useCase = new GetCredentialSpendUseCase(
  tokenUsageRepo,
  credentialRepo,
  new DrizzleWorkspaceRepository(db),
);

/**
 * O relatório de gasto das chaves do owner.
 *
 * Nasceu com a RN-058: desde que o agente gasta a credencial do dono do
 * workspace, quem paga precisa ver a conta — e nenhuma tela respondia "quanto
 * saiu da minha chave este mês".
 */
async function setup() {
  const [dono] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-dono-gasto', email: 'dono-gasto@brabo.dev' })
    .returning();

  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'Acme', slug: 'acme-gasto', createdBy: dono.id })
    .returning();

  const [projeto] = await db
    .insert(projects)
    .values({
      workspaceId: ws.id,
      name: 'P',
      slug: 'p-gasto',
      createdBy: dono.id,
    })
    .returning();

  const [sessao] = await db
    .insert(sessions)
    .values({ projectId: projeto.id, createdBy: dono.id })
    .returning();

  const [modelo] = await db
    .insert(models)
    .values({ provider: 'openrouter', name: 'algum/modelo', displayName: 'M' })
    .returning();

  return { dono, ws, projeto, sessao, modelo };
}

async function gasto(input: {
  sessionId: string;
  modelId: string;
  provider: 'openrouter' | 'openai';
  actorKind: 'agent' | 'user';
  actorId: string;
  costMicros: number;
}) {
  await tokenUsageRepo.record({
    sessionId: input.sessionId,
    actor: { kind: input.actorKind, id: input.actorId },
    provider: input.provider,
    modelId: input.modelId,
    modelName: 'algum/modelo',
    inputTokens: 10,
    outputTokens: 5,
    estimated: false,
    costMicros: input.costMicros,
    latencyMs: 100,
    inputPricePerMillionMicros: 0,
    outputPricePerMillionMicros: 0,
  });
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('GetCredentialSpendUseCase', () => {
  it('agrupa por PROVIDER, que é a unidade da credencial', async () => {
    const { ws, sessao, modelo } = await setup();
    await gasto({
      sessionId: sessao.id,
      modelId: modelo.id,
      provider: 'openrouter',
      actorKind: 'agent',
      actorId: 'criativo',
      costMicros: 1_000,
    });
    await gasto({
      sessionId: sessao.id,
      modelId: modelo.id,
      provider: 'openai',
      actorKind: 'agent',
      actorId: 'po',
      costMicros: 400,
    });

    const relatorio = await useCase.execute(ws.id);

    expect(relatorio.totalMicros).toBe(1_400);
    expect(relatorio.porProvider.map((p) => p.provider)).toEqual([
      'openrouter',
      'openai',
    ]);
  });

  /**
   * As duas coisas saem da MESMA chave desde a RN-058, e "meus agentes estão
   * caros?" é uma pergunta diferente de "eu uso muito o chat?".
   */
  it('separa o que gastou AGENTE do que gastou pessoa', async () => {
    const { ws, sessao, modelo, dono } = await setup();
    await gasto({
      sessionId: sessao.id,
      modelId: modelo.id,
      provider: 'openrouter',
      actorKind: 'agent',
      actorId: 'criativo',
      costMicros: 900,
    });
    await gasto({
      sessionId: sessao.id,
      modelId: modelo.id,
      provider: 'openrouter',
      actorKind: 'user',
      actorId: dono.id,
      costMicros: 350,
    });

    const [openrouter] = (await useCase.execute(ws.id)).porProvider;

    expect(openrouter.costMicrosAgentes).toBe(900);
    expect(openrouter.costMicrosPessoas).toBe(350);
    expect(openrouter.costMicros).toBe(1_250);
  });

  it('diz o dono das chaves e se a credencial ainda existe', async () => {
    const { ws, dono, sessao, modelo } = await setup();
    await credentialRepo.upsert(
      dono.id,
      'openrouter',
      encryption.encrypt('sk-or-v1-x'),
    );
    await gasto({
      sessionId: sessao.id,
      modelId: modelo.id,
      provider: 'openrouter',
      actorKind: 'agent',
      actorId: 'criativo',
      costMicros: 10,
    });
    await gasto({
      sessionId: sessao.id,
      modelId: modelo.id,
      provider: 'openai',
      actorKind: 'agent',
      actorId: 'po',
      costMicros: 10,
    });

    const relatorio = await useCase.execute(ws.id);

    expect(relatorio.ownerId).toBe(dono.id);
    const porProvider = Object.fromEntries(
      relatorio.porProvider.map((p) => [p.provider, p.temCredencial]),
    );
    // Gasto de chave REMOVIDA (ou nunca cadastrada aqui) não some do
    // histórico: ele aconteceu.
    expect(porProvider.openrouter).toBe(true);
    expect(porProvider.openai).toBe(false);
  });

  it('workspace sem gasto nenhum devolve relatório vazio, não erro', async () => {
    const { ws } = await setup();

    const relatorio = await useCase.execute(ws.id);

    expect(relatorio.totalMicros).toBe(0);
    expect(relatorio.porProvider).toEqual([]);
  });
});
