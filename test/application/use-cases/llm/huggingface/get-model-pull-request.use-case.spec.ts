import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../../support/test-db';
import { users, workspaces } from '../../../../../src/db/schema';
import { DrizzleModelPullRequestRepository } from '../../../../../src/infrastructure/persistence/drizzle/model-pull-request.repository';
import { GetModelPullRequestUseCase } from '../../../../../src/application/use-cases/llm/huggingface/get-model-pull-request.use-case';

const { db, pool } = createTestDb();
const repo = new DrizzleModelPullRequestRepository(db);
const useCase = new GetModelPullRequestUseCase(repo);

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('GetModelPullRequestUseCase', () => {
  it('caminho feliz: devolve o status atual do pedido', async () => {
    const [dono] = await db
      .insert(users)
      .values({ keycloakSub: 'sub-hf-get', email: 'hf-get@brabo.dev' })
      .returning();
    const [ws] = await db
      .insert(workspaces)
      .values({ name: 'Acme', slug: 'acme-hf-get', createdBy: dono.id })
      .returning();
    const [vizinho] = await db
      .insert(workspaces)
      .values({ name: 'Outra', slug: 'outra-hf-get', createdBy: dono.id })
      .returning();
    const pedido = await repo.create({
      workspaceId: ws.id,
      requestedBy: dono.id,
      repoId: 'meta-llama/Llama-3.1-8B-Instruct-GGUF',
    });

    const status = await useCase.execute(pedido.id, ws.id);
    expect(status.status).toBe('pending_confirmation');

    // falha: pedido existe, mas não NESTE workspace — não vaza entre workspaces.
    await expect(useCase.execute(pedido.id, vizinho.id)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('falha: id inexistente é 404', async () => {
    const [dono] = await db
      .insert(users)
      .values({ keycloakSub: 'sub-hf-get-2', email: 'hf-get-2@brabo.dev' })
      .returning();
    const [ws] = await db
      .insert(workspaces)
      .values({ name: 'Acme', slug: 'acme-hf-get-2', createdBy: dono.id })
      .returning();

    await expect(
      useCase.execute('00000000-0000-0000-0000-000000000000', ws.id),
    ).rejects.toThrow(NotFoundException);
  });
});
