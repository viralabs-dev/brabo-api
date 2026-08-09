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
import { DrizzleModelRepository } from '../../../../src/infrastructure/persistence/drizzle/model.repository';
import { DrizzleWorkspaceModelRepository } from '../../../../src/infrastructure/persistence/drizzle/workspace-model.repository';
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';
import { SetModelBindingUseCase } from '../../../../src/application/use-cases/llm/set-model-binding.use-case';
import { ModelNotFitForAgentScopeError } from '../../../../src/domain/llm/model-capabilities';
import {
  chaveDeAgente,
  chaveDeArea,
  ScopeIdSemProjetoError,
} from '../../../../src/domain/llm/binding-scope-id';

const { db, pool } = createTestDb();
const modelRepo = new DrizzleModelRepository(db);
const workspaceModelRepo = new DrizzleWorkspaceModelRepository(db);
const useCase = new SetModelBindingUseCase(
  new DrizzleModelBindingRepository(db),
  modelRepo,
  workspaceModelRepo,
  new DrizzleProjectRepository(db),
);

async function setup() {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-set-binding', email: 'bind@brabo.dev' })
    .returning();

  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'Bind', slug: 'bind-ws', createdBy: user.id })
    .returning();

  const [comFerramentas] = await db
    .insert(models)
    .values({
      provider: 'openai',
      name: 'gpt-4o-mini',
      displayName: 'GPT-4o mini',
      supportsToolCalling: true,
    })
    .returning();

  const [chatOnly] = await db
    .insert(models)
    .values({
      provider: 'ollama',
      name: 'tagarela:1b',
      displayName: 'Tagarela 1B',
      // Sem passar nada: o default da coluna é `false`, e é justamente esse
      // default que protege modelo descoberto por sync na Fase 9c.
    })
    .returning();

  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: ws.id,
      name: 'Core',
      slug: 'core',
      createdBy: user.id,
    })
    .returning();

  /**
   * A curadoria do workspace (RN-043) passou a valer para `agent` e `area` no
   * ADR 0064, porque o `scope_id` deles carrega o projeto e o workspace virou
   * derivável. Antes esses escopos devolviam `null` e escapavam da checagem.
   */
  const ativarNoWorkspace = (modelId: string) =>
    workspaceModelRepo.setActive({
      workspaceId: ws.id,
      modelIds: [modelId],
      isActive: true,
      curatedBy: user.id,
    });

  return { user, ws, project, comFerramentas, chatOnly, ativarNoWorkspace };
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('SetModelBindingUseCase', () => {
  it('vincula um modelo com tool calling a um agente', async () => {
    const { user, project, comFerramentas, ativarNoWorkspace } = await setup();
    await ativarNoWorkspace(comFerramentas.id);

    const binding = await useCase.execute(
      'agent',
      chaveDeAgente(project.id, 'dev-backend'),
      comFerramentas.id,
      user.id,
    );

    expect(binding).toMatchObject({
      scope: 'agent',
      scopeId: `${project.id}:dev-backend`,
      modelId: comFerramentas.id,
    });
  });

  it('recusa modelo chat-only no escopo agent (RN-040)', async () => {
    const { user, project, chatOnly } = await setup();

    await expect(
      useCase.execute(
        'agent',
        chaveDeAgente(project.id, 'dev-backend'),
        chatOnly.id,
        user.id,
      ),
    ).rejects.toThrow(ModelNotFitForAgentScopeError);
  });

  it('não grava nada quando recusa', async () => {
    const { user, project, chatOnly } = await setup();

    await expect(
      useCase.execute(
        'agent',
        chaveDeAgente(project.id, 'qa'),
        chatOnly.id,
        user.id,
      ),
    ).rejects.toThrow(ModelNotFitForAgentScopeError);

    const bindings = await new DrizzleModelBindingRepository(db).findOne(
      'agent',
      chaveDeAgente(project.id, 'qa'),
    );
    expect(bindings).toBeNull();
  });

  it('aceita o mesmo modelo chat-only no escopo workspace', async () => {
    const { user, ws, chatOnly } = await setup();
    await workspaceModelRepo.setActive({
      workspaceId: ws.id,
      modelIds: [chatOnly.id],
      isActive: true,
      curatedBy: user.id,
    });

    await expect(
      useCase.execute('workspace', ws.id, chatOnly.id, user.id),
    ).resolves.toMatchObject({ scope: 'workspace' });
  });

  it('recusa binding novo para modelo desativado NAQUELE workspace (RN-043)', async () => {
    const { user, ws, comFerramentas } = await setup();
    await workspaceModelRepo.setActive({
      workspaceId: ws.id,
      modelIds: [comFerramentas.id],
      isActive: false,
      curatedBy: user.id,
    });

    await expect(
      useCase.execute('workspace', ws.id, comFerramentas.id, user.id),
    ).rejects.toMatchObject({
      name: 'ModelNotBindableError',
      motivo: 'inativo',
    });
  });

  it('modelo NUNCA curado também é recusado — ausência de linha é o desligado', async () => {
    const { user, ws, comFerramentas } = await setup();

    await expect(
      useCase.execute('workspace', ws.id, comFerramentas.id, user.id),
    ).rejects.toMatchObject({
      name: 'ModelNotBindableError',
      motivo: 'inativo',
    });
  });

  it('recusa binding novo para modelo que sumiu do provider (RN-043)', async () => {
    const { user, project, comFerramentas, ativarNoWorkspace } = await setup();
    await ativarNoWorkspace(comFerramentas.id);
    await modelRepo.setAvailability([comFerramentas.id], 'unavailable');

    await expect(
      useCase.execute(
        'agent',
        chaveDeAgente(project.id, 'dev-backend'),
        comFerramentas.id,
        user.id,
      ),
    ).rejects.toMatchObject({
      name: 'ModelNotBindableError',
      motivo: 'indisponivel',
    });
  });

  it('binding ANTIGO para modelo indisponível não é apagado — quem lida é a cascata', async () => {
    const { user, project, comFerramentas, ativarNoWorkspace } = await setup();
    await ativarNoWorkspace(comFerramentas.id);

    await useCase.execute(
      'agent',
      chaveDeAgente(project.id, 'dev-backend'),
      comFerramentas.id,
      user.id,
    );
    await modelRepo.setAvailability([comFerramentas.id], 'unavailable');

    const binding = await new DrizzleModelBindingRepository(db).findOne(
      'agent',
      chaveDeAgente(project.id, 'dev-backend'),
    );
    expect(binding).toMatchObject({ modelId: comFerramentas.id });
  });

  it('modelo inexistente continua sendo 404', async () => {
    const { user, project } = await setup();

    await expect(
      useCase.execute(
        'agent',
        chaveDeAgente(project.id, 'qa'),
        '00000000-0000-0000-0000-000000000000',
        user.id,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  // ------------------------------------------------ FASE 23 / ADR 0064

  it('a ÁREA exige tool calling como o agente — ela só é lida por agentes', async () => {
    const { user, project, chatOnly } = await setup();

    await expect(
      useCase.execute(
        'area',
        chaveDeArea(project.id, 'qa'),
        chatOnly.id,
        user.id,
      ),
    ).rejects.toThrow(ModelNotFitForAgentScopeError);
  });

  it('a ÁREA também responde pela curadoria do workspace (RN-043)', async () => {
    const { user, project, comFerramentas } = await setup();

    // Sem `ativarNoWorkspace`: modelo nunca curado. Antes do ADR 0064 este
    // caminho devolvia `null` de workspace e passava — o escopo `agent` não
    // tinha âncora nenhuma.
    await expect(
      useCase.execute(
        'area',
        chaveDeArea(project.id, 'qa'),
        comFerramentas.id,
        user.id,
      ),
    ).rejects.toMatchObject({
      name: 'ModelNotBindableError',
      motivo: 'inativo',
    });
  });

  it('falha: `scope_id` de agente sem projeto é recusado (RN-103)', async () => {
    const { user, comFerramentas, ativarNoWorkspace } = await setup();
    await ativarNoWorkspace(comFerramentas.id);

    // O formato antigo, global. Gravá-lo criaria um binding que a cascata
    // nunca mais encontraria.
    await expect(
      useCase.execute('agent', 'dev-backend', comFerramentas.id, user.id),
    ).rejects.toThrow(ScopeIdSemProjetoError);
    await expect(
      useCase.execute('area', 'qa', comFerramentas.id, user.id),
    ).rejects.toThrow(ScopeIdSemProjetoError);
  });
});
