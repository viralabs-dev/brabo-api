import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { models, users, workspaces } from '../../../../src/db/schema';
import { DrizzleModelRepository } from '../../../../src/infrastructure/persistence/drizzle/model.repository';
import { DrizzleWorkspaceModelRepository } from '../../../../src/infrastructure/persistence/drizzle/workspace-model.repository';
import { SetModelsActiveUseCase } from '../../../../src/application/use-cases/llm/set-models-active.use-case';
import { SetModelUsesUseCase } from '../../../../src/application/use-cases/llm/set-model-uses.use-case';
import { ListModelCatalogUseCase } from '../../../../src/application/use-cases/llm/list-model-catalog.use-case';

const { db, pool } = createTestDb();
const repo = new DrizzleModelRepository(db);
const workspaceRepo = new DrizzleWorkspaceModelRepository(db);
const setUses = new SetModelUsesUseCase(repo, workspaceRepo);
const setActive = new SetModelsActiveUseCase(repo, workspaceRepo);
const listCatalog = new ListModelCatalogUseCase(workspaceRepo);

/**
 * Curadoria POR USO (Fase 13, ADR 0051).
 *
 * O eixo que nenhum catálogo publica: capability o provider declara, "rende no
 * nosso código" só se descobre usando. Por isso vive em `workspace_models`,
 * junto da outra opinião de quem opera — e, como ela, não atravessa a fronteira
 * do workspace.
 */
async function setup() {
  const [dono] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-usos', email: 'usos@brabo.dev' })
    .returning();

  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'Acme', slug: 'acme-usos', createdBy: dono.id })
    .returning();
  const [vizinho] = await db
    .insert(workspaces)
    .values({ name: 'Outra', slug: 'outra-usos', createdBy: dono.id })
    .returning();

  const [modelo] = await db
    .insert(models)
    .values({ provider: 'openai', name: 'gpt-4o', displayName: 'GPT-4o' })
    .returning();

  return { dono, ws, vizinho, modelo };
}

async function usosNoCatalogo(workspaceId: string, modelId: string) {
  const catalogo = await listCatalog.execute(workspaceId);
  return catalogo.cloud.openai.find((m) => m.id === modelId)?.uses;
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('SetModelUsesUseCase', () => {
  it('caminho feliz: marca os usos e eles voltam no catálogo daquele workspace', async () => {
    const { dono, ws, modelo } = await setup();

    // Sem linha de curadoria, a lista é vazia — "ninguém opinou", não "não
    // serve para nada".
    expect(await usosNoCatalogo(ws.id, modelo.id)).toEqual([]);

    const atualizados = await setUses.execute({
      workspaceId: ws.id,
      modelIds: [modelo.id],
      uses: ['codigo', 'analise'],
      curatedBy: dono.id,
    });

    expect(atualizados[0].uses).toEqual(['codigo', 'analise']);
    expect(await usosNoCatalogo(ws.id, modelo.id)).toEqual([
      'codigo',
      'analise',
    ]);
  });

  /**
   * O trap da coluna: `workspace_models.is_active` tem DEFAULT `true`, então
   * uma linha nascida da marcação de uso ligaria o modelo no seletor sem
   * ninguém ter autorizado o gasto (RN-043).
   */
  it('marcar uso NÃO liga o modelo — a linha nova nasce inativa', async () => {
    const { dono, ws, modelo } = await setup();

    await setUses.execute({
      workspaceId: ws.id,
      modelIds: [modelo.id],
      uses: ['codigo'],
      curatedBy: dono.id,
    });

    expect(await workspaceRepo.isActive(ws.id, modelo.id)).toBe(false);
  });

  it('trocar o uso não desliga o que já estava ligado', async () => {
    const { dono, ws, modelo } = await setup();
    await setActive.execute({
      workspaceId: ws.id,
      modelIds: [modelo.id],
      isActive: true,
      curatedBy: dono.id,
    });

    await setUses.execute({
      workspaceId: ws.id,
      modelIds: [modelo.id],
      uses: ['documentacao'],
      curatedBy: dono.id,
    });

    expect(await workspaceRepo.isActive(ws.id, modelo.id)).toBe(true);
  });

  it('a lista SUBSTITUI a anterior — é assim que se desmarca', async () => {
    const { dono, ws, modelo } = await setup();
    await setUses.execute({
      workspaceId: ws.id,
      modelIds: [modelo.id],
      uses: ['codigo', 'analise'],
      curatedBy: dono.id,
    });

    await setUses.execute({
      workspaceId: ws.id,
      modelIds: [modelo.id],
      uses: ['conversa'],
      curatedBy: dono.id,
    });
    expect(await usosNoCatalogo(ws.id, modelo.id)).toEqual(['conversa']);

    // Lista vazia é estado legítimo: desmarcou tudo.
    await setUses.execute({
      workspaceId: ws.id,
      modelIds: [modelo.id],
      uses: [],
      curatedBy: dono.id,
    });
    expect(await usosNoCatalogo(ws.id, modelo.id)).toEqual([]);
  });

  it('o uso vale só neste workspace (ADR 0049)', async () => {
    const { dono, ws, vizinho, modelo } = await setup();

    await setUses.execute({
      workspaceId: ws.id,
      modelIds: [modelo.id],
      uses: ['codigo'],
      curatedBy: dono.id,
    });

    expect(await usosNoCatalogo(vizinho.id, modelo.id)).toEqual([]);
  });

  it('uso repetido no corpo é a mesma decisão dita duas vezes, não erro', async () => {
    const { dono, ws, modelo } = await setup();

    await setUses.execute({
      workspaceId: ws.id,
      modelIds: [modelo.id],
      uses: ['codigo', 'codigo'],
      curatedBy: dono.id,
    });

    expect(await usosNoCatalogo(ws.id, modelo.id)).toEqual(['codigo']);
  });

  it('falha: um id inexistente reprova o lote INTEIRO sem aplicar nada', async () => {
    const { dono, ws, modelo } = await setup();

    await expect(
      setUses.execute({
        workspaceId: ws.id,
        modelIds: [modelo.id, '00000000-0000-0000-0000-000000000000'],
        uses: ['codigo'],
        curatedBy: dono.id,
      }),
    ).rejects.toThrow(NotFoundException);

    expect(await usosNoCatalogo(ws.id, modelo.id)).toEqual([]);
  });
});
