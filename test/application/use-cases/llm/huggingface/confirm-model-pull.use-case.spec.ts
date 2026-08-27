import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../../support/test-db';
import { users, workspaces } from '../../../../../src/db/schema';
import { DrizzleModelPullRequestRepository } from '../../../../../src/infrastructure/persistence/drizzle/model-pull-request.repository';
import { DrizzleModelRepository } from '../../../../../src/infrastructure/persistence/drizzle/model.repository';
import { DrizzleWorkspaceModelRepository } from '../../../../../src/infrastructure/persistence/drizzle/workspace-model.repository';
import { ConfirmModelPullUseCase } from '../../../../../src/application/use-cases/llm/huggingface/confirm-model-pull.use-case';
import type { OllamaProvider } from '../../../../../src/infrastructure/llm/ollama-provider';
import {
  LLMConnectionError,
  LLMUpstreamError,
} from '../../../../../src/domain/llm/llm-provider-errors';

const { db, pool } = createTestDb();
const pullRequests = new DrizzleModelPullRequestRepository(db);
const models = new DrizzleModelRepository(db);
const workspaceModels = new DrizzleWorkspaceModelRepository(db);

/** Substitui o daemon Ollama de verdade — o que está sob teste é a orquestração. */
function fakeOllama(pullModel: OllamaProvider['pullModel']) {
  return { pullModel } as unknown as OllamaProvider;
}

async function setup() {
  const [dono] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-hf-confirm', email: 'hf-confirm@brabo.dev' })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'Acme', slug: 'acme-hf-confirm', createdBy: dono.id })
    .returning();
  return { dono, ws };
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('ConfirmModelPullUseCase', () => {
  it('caminho feliz: confirma, puxa, ativa no catálogo do workspace e marca active', async () => {
    const { dono, ws } = await setup();
    const pedido = await pullRequests.create({
      workspaceId: ws.id,
      requestedBy: dono.id,
      repoId: 'meta-llama/Llama-3.1-8B-Instruct-GGUF',
    });

    const pullModel = vi.fn().mockResolvedValue(undefined);
    const useCase = new ConfirmModelPullUseCase(
      pullRequests,
      models,
      workspaceModels,
      fakeOllama(pullModel),
    );

    const resultado = await useCase.execute({
      id: pedido.id,
      workspaceId: ws.id,
      confirmedBy: dono.id,
    });

    expect(pullModel).toHaveBeenCalledWith(
      'meta-llama/Llama-3.1-8B-Instruct-GGUF',
    );
    expect(resultado.status).toBe('active');
    expect(resultado.confirmedAt).not.toBeNull();

    const catalogo = await models.listByProvider('ollama');
    const modelo = catalogo.find(
      (m) => m.name === 'hf.co/meta-llama/Llama-3.1-8B-Instruct-GGUF',
    );
    expect(modelo).toBeDefined();
    expect(await workspaceModels.isActive(ws.id, modelo!.id)).toBe(true);
  });

  it('falha: o Ollama recusa o pull — o pedido termina failed com a origem declarada', async () => {
    const { dono, ws } = await setup();
    const pedido = await pullRequests.create({
      workspaceId: ws.id,
      requestedBy: dono.id,
      repoId: 'publisher-qualquer/modelo-inexistente',
    });

    const pullModel = vi
      .fn()
      .mockRejectedValue(
        new LLMUpstreamError(
          'ollama',
          'pull de "x" falhou: repo não encontrado',
        ),
      );
    const useCase = new ConfirmModelPullUseCase(
      pullRequests,
      models,
      workspaceModels,
      fakeOllama(pullModel),
    );

    const resultado = await useCase.execute({
      id: pedido.id,
      workspaceId: ws.id,
      confirmedBy: dono.id,
    });

    expect(resultado.status).toBe('failed');
    expect(resultado.failedReason).toMatch(/^\[modelo\]/);

    // Nada foi ativado no catálogo — falha não deixa rastro de sucesso.
    const catalogo = await models.listByProvider('ollama');
    expect(catalogo).toHaveLength(0);
  });

  it('falha de conexão é classificada como origem "infra", não "modelo"', async () => {
    const { dono, ws } = await setup();
    const pedido = await pullRequests.create({
      workspaceId: ws.id,
      requestedBy: dono.id,
      repoId: 'meta-llama/Llama-3.1-8B-Instruct-GGUF',
    });

    const pullModel = vi
      .fn()
      .mockRejectedValue(new LLMConnectionError('ollama', 'ECONNREFUSED'));
    const useCase = new ConfirmModelPullUseCase(
      pullRequests,
      models,
      workspaceModels,
      fakeOllama(pullModel),
    );

    const resultado = await useCase.execute({
      id: pedido.id,
      workspaceId: ws.id,
      confirmedBy: dono.id,
    });

    expect(resultado.status).toBe('failed');
    expect(resultado.failedReason).toMatch(/^\[infra\]/);
  });

  it('recusa confirmar um pedido que já não está pending_confirmation', async () => {
    const { dono, ws } = await setup();
    const pedido = await pullRequests.create({
      workspaceId: ws.id,
      requestedBy: dono.id,
      repoId: 'meta-llama/Llama-3.1-8B-Instruct-GGUF',
    });
    await pullRequests.markConfirmed(pedido.id);

    const useCase = new ConfirmModelPullUseCase(
      pullRequests,
      models,
      workspaceModels,
      fakeOllama(vi.fn()),
    );

    await expect(
      useCase.execute({
        id: pedido.id,
        workspaceId: ws.id,
        confirmedBy: dono.id,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('404 para um id que não existe no workspace', async () => {
    const { dono, ws } = await setup();
    const useCase = new ConfirmModelPullUseCase(
      pullRequests,
      models,
      workspaceModels,
      fakeOllama(vi.fn()),
    );

    await expect(
      useCase.execute({
        id: '00000000-0000-0000-0000-000000000000',
        workspaceId: ws.id,
        confirmedBy: dono.id,
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
