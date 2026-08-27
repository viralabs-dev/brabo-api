import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, truncateAll } from '../../../../support/test-db';
import { users, workspaces } from '../../../../../src/db/schema';
import { DrizzleModelPullRequestRepository } from '../../../../../src/infrastructure/persistence/drizzle/model-pull-request.repository';
import { RequestModelPullUseCase } from '../../../../../src/application/use-cases/llm/huggingface/request-model-pull.use-case';

const { db, pool } = createTestDb();
const repo = new DrizzleModelPullRequestRepository(db);
const useCase = new RequestModelPullUseCase(repo);

async function setup() {
  const [dono] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-hf-pull', email: 'hf-pull@brabo.dev' })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'Acme', slug: 'acme-hf', createdBy: dono.id })
    .returning();
  return { dono, ws };
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('RequestModelPullUseCase', () => {
  it('caminho feliz: cria o pedido em pending_confirmation — nada além disso', async () => {
    const { dono, ws } = await setup();

    const pedido = await useCase.execute({
      workspaceId: ws.id,
      requestedBy: dono.id,
      repoId: 'meta-llama/Llama-3.1-8B-Instruct-GGUF',
      estimatedSizeBytes: 4_900_000_000,
    });

    expect(pedido.status).toBe('pending_confirmation');
    expect(pedido.confirmedAt).toBeNull();
    expect(pedido.failedReason).toBeNull();
    expect(pedido.repoId).toBe('meta-llama/Llama-3.1-8B-Instruct-GGUF');
    expect(pedido.estimatedSizeBytes).toBe(4_900_000_000);

    const relido = await repo.findById(pedido.id);
    expect(relido?.status).toBe('pending_confirmation');
  });

  it('estimatedSizeBytes é opcional — ausência do Hub não vira palpite', async () => {
    const { dono, ws } = await setup();

    const pedido = await useCase.execute({
      workspaceId: ws.id,
      requestedBy: dono.id,
      repoId: 'meta-llama/Llama-3.1-8B-Instruct-GGUF',
    });

    expect(pedido.estimatedSizeBytes).toBeNull();
  });

  it('falha: workspace inexistente reprova pela FK, não silenciosamente', async () => {
    const { dono } = await setup();

    await expect(
      useCase.execute({
        workspaceId: '00000000-0000-0000-0000-000000000000',
        requestedBy: dono.id,
        repoId: 'meta-llama/Llama-3.1-8B-Instruct-GGUF',
      }),
    ).rejects.toThrow();
  });
});
