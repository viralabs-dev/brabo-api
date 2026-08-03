import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { models, projects, users, workspaces } from '../../../../src/db/schema';
import { DrizzleModelRepository } from '../../../../src/infrastructure/persistence/drizzle/model.repository';
import { DrizzleWorkspaceModelRepository } from '../../../../src/infrastructure/persistence/drizzle/workspace-model.repository';
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';
import { SetModelsActiveUseCase } from '../../../../src/application/use-cases/llm/set-models-active.use-case';
import { ListModelCatalogUseCase } from '../../../../src/application/use-cases/llm/list-model-catalog.use-case';
import { ListModelsUseCase } from '../../../../src/application/use-cases/llm/list-models.use-case';

const { db, pool } = createTestDb();
const repo = new DrizzleModelRepository(db);
const workspaceRepo = new DrizzleWorkspaceModelRepository(db);
const projectRepo = new DrizzleProjectRepository(db);
const setActive = new SetModelsActiveUseCase(repo, workspaceRepo);
const listCatalog = new ListModelCatalogUseCase(workspaceRepo);
const listAtivos = new ListModelsUseCase(workspaceRepo, projectRepo);

/**
 * Dois workspaces de propósito, e não um: a regra que o ADR 0049 introduz só
 * é observável quando existe um vizinho para NÃO ser afetado.
 */
async function setup() {
  const [dono] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-curadoria', email: 'curadoria@brabo.dev' })
    .returning();

  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'Acme', slug: 'acme', createdBy: dono.id })
    .returning();
  const [vizinho] = await db
    .insert(workspaces)
    .values({ name: 'Outra', slug: 'outra', createdBy: dono.id })
    .returning();

  const [projeto] = await db
    .insert(projects)
    .values({
      workspaceId: ws.id,
      name: 'Projeto',
      slug: 'projeto',
      createdBy: dono.id,
    })
    .returning();

  const [descoberto] = await db
    .insert(models)
    .values({
      provider: 'openai',
      name: 'gpt-4o-mini',
      displayName: 'GPT-4o mini',
    })
    .returning();

  const [outro] = await db
    .insert(models)
    .values({ provider: 'openai', name: 'gpt-4o', displayName: 'GPT-4o' })
    .returning();

  // Nenhum dos dois tem linha de curadoria — é assim que o sync deixa todo
  // modelo novo (RN-043): ausência de linha É o desligado.
  return { dono, ws, vizinho, projeto, descoberto, outro };
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('SetModelsActiveUseCase', () => {
  it('caminho feliz: ativa o lote e os modelos passam a aparecer no seletor', async () => {
    const { dono, ws, projeto, descoberto, outro } = await setup();

    const antes = await listAtivos.execute(projeto.id);
    expect(antes.cloud.openai ?? []).toEqual([]);

    const atualizados = await setActive.execute({
      workspaceId: ws.id,
      modelIds: [descoberto.id, outro.id],
      isActive: true,
      curatedBy: dono.id,
    });

    expect(atualizados.map((m) => m.isActive)).toEqual([true, true]);

    const depois = await listAtivos.execute(projeto.id);
    expect(depois.cloud.openai.map((m) => m.name).sort()).toEqual([
      'gpt-4o',
      'gpt-4o-mini',
    ]);
  });

  it('ativar num workspace NÃO liga o modelo no vizinho (ADR 0049)', async () => {
    const { dono, ws, vizinho, descoberto } = await setup();

    await setActive.execute({
      workspaceId: ws.id,
      modelIds: [descoberto.id],
      isActive: true,
      curatedBy: dono.id,
    });

    // O defeito que a fase existe para corrigir: antes, `models.is_active` era
    // uma coluna só para a instalação inteira, e esta asserção falharia.
    const doVizinho = await workspaceRepo.listActive(vizinho.id);
    expect(doVizinho).toEqual([]);

    const catalogoDoVizinho = await listCatalog.execute(vizinho.id);
    expect(
      catalogoDoVizinho.cloud.openai.find((m) => m.id === descoberto.id)
        ?.isActive,
    ).toBe(false);
  });

  it('o modelo inativo aparece no catálogo de curadoria mesmo antes de ativado', async () => {
    const { ws } = await setup();

    const catalogo = await listCatalog.execute(ws.id);
    expect(catalogo.cloud.openai.map((m) => m.name).sort()).toEqual([
      'gpt-4o',
      'gpt-4o-mini',
    ]);
    // Sem linha de curadoria nenhuma, o LEFT JOIN tem que devolver `false` —
    // não sumir com a linha, que é o que um INNER faria.
    expect(catalogo.cloud.openai.every((m) => !m.isActive)).toBe(true);
  });

  it('desativar não mexe em `availability`', async () => {
    const { dono, ws, descoberto } = await setup();

    await setActive.execute({
      workspaceId: ws.id,
      modelIds: [descoberto.id],
      isActive: false,
      curatedBy: dono.id,
    });

    expect(await workspaceRepo.isActive(ws.id, descoberto.id)).toBe(false);
    // `availability` é global e do sync — a curadoria não encosta nele.
    expect((await repo.findById(descoberto.id))?.availability).toBe(
      'available',
    );
  });

  it('falha: um id inexistente reprova o lote INTEIRO sem aplicar nada', async () => {
    const { dono, ws, descoberto } = await setup();

    await expect(
      setActive.execute({
        workspaceId: ws.id,
        modelIds: [descoberto.id, '00000000-0000-0000-0000-000000000000'],
        isActive: true,
        curatedBy: dono.id,
      }),
    ).rejects.toThrow(NotFoundException);

    expect(await workspaceRepo.isActive(ws.id, descoberto.id)).toBe(false);
  });
});
