import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  models,
  projects,
  users,
  workspaceModels,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleModelRepository } from '../../../../src/infrastructure/persistence/drizzle/model.repository';
import { DrizzleWorkspaceModelRepository } from '../../../../src/infrastructure/persistence/drizzle/workspace-model.repository';
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';
import { SetModelsActiveUseCase } from '../../../../src/application/use-cases/llm/set-models-active.use-case';
import { ListModelCatalogUseCase } from '../../../../src/application/use-cases/llm/list-model-catalog.use-case';
import { ListModelsUseCase } from '../../../../src/application/use-cases/llm/list-models.use-case';
import { AliasDeRoteamentoLivreError } from '../../../../src/domain/llm/alias-de-roteamento-livre';

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

/**
 * AT-271, RN-679 — decisão do dono (01/10): o alias de roteamento livre do
 * OpenRouter (`~…`) não entra na curadoria. Preço de vitrine, cobrança pelo
 * upstream que atender.
 */
describe('SetModelsActiveUseCase — alias de roteamento livre (RN-679)', () => {
  async function comAlias() {
    const base = await setup();
    const [alias] = await db
      .insert(models)
      .values({
        provider: 'openrouter',
        name: '~deepseek/deepseek-flash-latest',
        displayName: 'DeepSeek Flash (latest)',
      })
      .returning();
    const [fixo] = await db
      .insert(models)
      .values({
        provider: 'openrouter',
        name: 'deepseek/deepseek-v4.1-flash',
        displayName: 'DeepSeek V4.1 Flash',
      })
      .returning();
    return { ...base, alias, fixo };
  }

  it('falha: ativar o alias `~` recusa o lote INTEIRO, com código e ids', async () => {
    const { dono, ws, alias, fixo } = await comAlias();

    const erro = await setActive
      .execute({
        workspaceId: ws.id,
        modelIds: [fixo.id, alias.id],
        isActive: true,
        curatedBy: dono.id,
      })
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(AliasDeRoteamentoLivreError);
    expect((erro as AliasDeRoteamentoLivreError).code).toBe(
      'alias_de_roteamento_livre',
    );
    expect(
      (erro as AliasDeRoteamentoLivreError).models.map((m) => m.id),
    ).toEqual([alias.id]);
    expect((erro as Error).message).toContain(
      '~deepseek/deepseek-flash-latest',
    );
    // Nem o modelo de upstream fixo do mesmo lote foi ligado.
    expect(await workspaceRepo.isActive(ws.id, fixo.id)).toBe(false);
    expect(await workspaceRepo.isActive(ws.id, alias.id)).toBe(false);
  });

  it('caminho feliz: modelo de upstream fixo do OpenRouter ativa, e sai sem a marca', async () => {
    const { dono, ws, fixo } = await comAlias();

    const [ativado] = await setActive.execute({
      workspaceId: ws.id,
      modelIds: [fixo.id],
      isActive: true,
      curatedBy: dono.id,
    });

    expect(ativado.isActive).toBe(true);
    expect(ativado.freeRoutingAlias).toBe(false);
  });

  it('o `~` só é alias no OpenRouter: o mesmo nome noutro provider ativa', async () => {
    const { dono, ws } = await setup();
    const [outro] = await db
      .insert(models)
      .values({ provider: 'openai', name: '~nome-raro', displayName: 'Raro' })
      .returning();

    const [ativado] = await setActive.execute({
      workspaceId: ws.id,
      modelIds: [outro.id],
      isActive: true,
      curatedBy: dono.id,
    });
    expect(ativado.isActive).toBe(true);
    expect(ativado.freeRoutingAlias).toBe(false);
  });

  it('alias já curado ANTES da regra: segue ativo, sai marcado, desliga, e não volta', async () => {
    const { dono, ws, alias } = await comAlias();
    // O estado do banco de quem curou antes da regra: linha ativa gravada
    // direto, porque a rota não deixa mais criá-la.
    await db.insert(workspaceModels).values({
      workspaceId: ws.id,
      modelId: alias.id,
      isActive: true,
      curatedBy: dono.id,
    });

    const catalogo = await listCatalog.execute(ws.id);
    const linha = catalogo.cloud.openrouter.find((m) => m.id === alias.id);
    expect(linha?.isActive).toBe(true);
    expect(linha?.freeRoutingAlias).toBe(true);

    const [desligado] = await setActive.execute({
      workspaceId: ws.id,
      modelIds: [alias.id],
      isActive: false,
      curatedBy: dono.id,
    });
    expect(desligado.isActive).toBe(false);

    await expect(
      setActive.execute({
        workspaceId: ws.id,
        modelIds: [alias.id],
        isActive: true,
        curatedBy: dono.id,
      }),
    ).rejects.toThrow(AliasDeRoteamentoLivreError);
    expect(await workspaceRepo.isActive(ws.id, alias.id)).toBe(false);
  });
});
