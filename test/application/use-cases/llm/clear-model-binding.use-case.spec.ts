import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  models,
  projects,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleModelBindingRepository } from '../../../../src/infrastructure/persistence/drizzle/model-binding.repository';
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';
import { ClearModelBindingUseCase } from '../../../../src/application/use-cases/llm/clear-model-binding.use-case';
import { ResolveModelBindingUseCase } from '../../../../src/application/use-cases/llm/resolve-model-binding.use-case';
import {
  chaveDeAgente,
  chaveDeArea,
  ScopeIdSemProjetoError,
} from '../../../../src/domain/llm/binding-scope-id';

const { db, pool } = createTestDb();
const bindingRepo = new DrizzleModelBindingRepository(db);
const clearBinding = new ClearModelBindingUseCase(bindingRepo);
const resolveBinding = new ResolveModelBindingUseCase(
  bindingRepo,
  new DrizzleProjectRepository(db),
);

async function setup() {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-clear', email: 'clear@brabo.dev' })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme-clear', createdBy: user.id })
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
  const [daArea] = await db
    .insert(models)
    .values({
      provider: 'ollama',
      name: 'da-area',
      displayName: 'Da área',
      supportsToolCalling: true,
    })
    .returning();
  const [doAgente] = await db
    .insert(models)
    .values({
      provider: 'ollama',
      name: 'do-agente',
      displayName: 'Do agente',
      supportsToolCalling: true,
    })
    .returning();
  return { user, project, daArea, doAgente };
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('ClearModelBindingUseCase (voltar a herdar — RN-102)', () => {
  it('caminho feliz: apagar o binding do agente devolve o padrão da área', async () => {
    const { user, project, daArea, doAgente } = await setup();

    await bindingRepo.upsert({
      scope: 'area',
      scopeId: chaveDeArea(project.id, 'qa'),
      modelId: daArea.id,
      createdBy: user.id,
    });
    await bindingRepo.upsert({
      scope: 'agent',
      scopeId: chaveDeAgente(project.id, 'qa-automacao'),
      modelId: doAgente.id,
      createdBy: user.id,
    });

    expect(
      await resolveBinding.execute({
        projectId: project.id,
        agentId: 'qa-automacao',
      }),
    ).toMatchObject({ modelId: doAgente.id, origin: 'agent' });

    await clearBinding.execute(
      'agent',
      chaveDeAgente(project.id, 'qa-automacao'),
    );

    expect(
      await resolveBinding.execute({
        projectId: project.id,
        agentId: 'qa-automacao',
      }),
    ).toMatchObject({ modelId: daArea.id, origin: 'area' });
  });

  it('herdar é a AUSÊNCIA da linha, não uma cópia do modelo da área', async () => {
    const { user, project, daArea, doAgente } = await setup();

    await bindingRepo.upsert({
      scope: 'area',
      scopeId: chaveDeArea(project.id, 'qa'),
      modelId: daArea.id,
      createdBy: user.id,
    });
    await bindingRepo.upsert({
      scope: 'agent',
      scopeId: chaveDeAgente(project.id, 'qa-automacao'),
      modelId: doAgente.id,
      createdBy: user.id,
    });

    await clearBinding.execute(
      'agent',
      chaveDeAgente(project.id, 'qa-automacao'),
    );

    // Se o "voltar a herdar" tivesse GRAVADO o modelo da área no agente, a
    // linha estaria aqui — e a próxima mudança da área deixaria este agente
    // para trás em silêncio.
    expect(
      await bindingRepo.findOne(
        'agent',
        chaveDeAgente(project.id, 'qa-automacao'),
      ),
    ).toBeNull();
  });

  it('apagar o padrão da área não decide pelos agentes que divergiram', async () => {
    const { user, project, daArea, doAgente } = await setup();

    await bindingRepo.upsert({
      scope: 'area',
      scopeId: chaveDeArea(project.id, 'qa'),
      modelId: daArea.id,
      createdBy: user.id,
    });
    await bindingRepo.upsert({
      scope: 'agent',
      scopeId: chaveDeAgente(project.id, 'qa-automacao'),
      modelId: doAgente.id,
      createdBy: user.id,
    });

    await clearBinding.execute('area', chaveDeArea(project.id, 'qa'));

    expect(
      await resolveBinding.execute({
        projectId: project.id,
        agentId: 'qa-automacao',
      }),
    ).toMatchObject({ modelId: doAgente.id, origin: 'agent' });
  });

  it('falha: escopo que já herda é 404, não silêncio', async () => {
    const { project } = await setup();

    // "Apaguei o que não existia" e "apaguei" são respostas diferentes para a
    // mesma tela — a segunda esconderia um slug digitado errado.
    await expect(
      clearBinding.execute('agent', chaveDeAgente(project.id, 'nao-existe')),
    ).rejects.toThrow(NotFoundException);
  });

  it('falha: `scope_id` sem projeto é recusado antes de tocar o banco', async () => {
    await setup();

    await expect(clearBinding.execute('agent', 'qa-automacao')).rejects.toThrow(
      ScopeIdSemProjetoError,
    );
  });
});
