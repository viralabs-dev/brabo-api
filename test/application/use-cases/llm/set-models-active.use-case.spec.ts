import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { models } from '../../../../src/db/schema';
import { DrizzleModelRepository } from '../../../../src/infrastructure/persistence/drizzle/model.repository';
import { SetModelsActiveUseCase } from '../../../../src/application/use-cases/llm/set-models-active.use-case';
import { ListModelCatalogUseCase } from '../../../../src/application/use-cases/llm/list-model-catalog.use-case';
import { ListModelsUseCase } from '../../../../src/application/use-cases/llm/list-models.use-case';

const { db, pool } = createTestDb();
const repo = new DrizzleModelRepository(db);
const setActive = new SetModelsActiveUseCase(repo);
const listCatalog = new ListModelCatalogUseCase(repo);
const listAtivos = new ListModelsUseCase(repo);

async function setup() {
  const [descoberto] = await db
    .insert(models)
    .values({
      provider: 'openai',
      name: 'gpt-4o-mini',
      displayName: 'GPT-4o mini',
      // É assim que o sync de catálogo deixa todo modelo novo (RN-041).
      isActive: false,
    })
    .returning();

  const [outro] = await db
    .insert(models)
    .values({
      provider: 'openai',
      name: 'gpt-4o',
      displayName: 'GPT-4o',
      isActive: false,
    })
    .returning();

  return { descoberto, outro };
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('SetModelsActiveUseCase', () => {
  it('caminho feliz: ativa o lote e os modelos passam a aparecer no seletor', async () => {
    const { descoberto, outro } = await setup();

    const antes = await listAtivos.execute();
    expect(antes.cloud.openai ?? []).toEqual([]);

    const atualizados = await setActive.execute({
      modelIds: [descoberto.id, outro.id],
      isActive: true,
    });

    expect(atualizados.map((m) => m.isActive)).toEqual([true, true]);

    const depois = await listAtivos.execute();
    expect(depois.cloud.openai.map((m) => m.name).sort()).toEqual([
      'gpt-4o',
      'gpt-4o-mini',
    ]);
  });

  it('o modelo inativo aparece no catálogo de curadoria mesmo antes de ativado', async () => {
    await setup();

    const catalogo = await listCatalog.execute();
    expect(catalogo.cloud.openai.map((m) => m.name).sort()).toEqual([
      'gpt-4o',
      'gpt-4o-mini',
    ]);
  });

  it('desativar não mexe em `availability`', async () => {
    const { descoberto } = await setup();

    await setActive.execute({ modelIds: [descoberto.id], isActive: false });

    const depois = await repo.findById(descoberto.id);
    expect(depois).toMatchObject({
      isActive: false,
      availability: 'available',
    });
  });

  it('falha: um id inexistente reprova o lote INTEIRO sem aplicar nada', async () => {
    const { descoberto } = await setup();

    await expect(
      setActive.execute({
        modelIds: [descoberto.id, '00000000-0000-0000-0000-000000000000'],
        isActive: true,
      }),
    ).rejects.toThrow(NotFoundException);

    const intocado = await repo.findById(descoberto.id);
    expect(intocado?.isActive).toBe(false);
  });
});
