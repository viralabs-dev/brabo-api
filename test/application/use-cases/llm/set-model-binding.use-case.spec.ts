import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { models, projects, users, workspaces } from '../../../../src/db/schema';
import { DrizzleModelBindingRepository } from '../../../../src/infrastructure/persistence/drizzle/model-binding.repository';
import { DrizzleModelRepository } from '../../../../src/infrastructure/persistence/drizzle/model.repository';
import { DrizzleWorkspaceModelRepository } from '../../../../src/infrastructure/persistence/drizzle/workspace-model.repository';
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';
import { SetModelBindingUseCase } from '../../../../src/application/use-cases/llm/set-model-binding.use-case';
import { ModelNotFitForAgentScopeError } from '../../../../src/domain/llm/model-capabilities';
import { RoutingPreferenceNotSupportedError } from '../../../../src/domain/llm/routing-preference';
import type { LLMProvider } from '../../../../src/application/ports/llm-provider.port';
import type { LLMProviderRegistry } from '../../../../src/application/ports/llm-provider-registry.port';
import {
  chaveDeAgente,
  chaveDeArea,
  ScopeIdSemProjetoError,
} from '../../../../src/domain/llm/binding-scope-id';

const { db, pool } = createTestDb();
const modelRepo = new DrizzleModelRepository(db);
const workspaceModelRepo = new DrizzleWorkspaceModelRepository(db);
/**
 * Registro FALSO de providers: só as capabilities importam aqui. O OpenRouter
 * declara `routingPreference` conforme `hubAceita` — o estado de produção é
 * `false` (não provado, ADR 0166), e os testes que precisam do `true` ligam.
 */
let hubAceita = false;
const registry: LLMProviderRegistry = {
  get: (name) =>
    ({
      name,
      capabilities: {
        streaming: true,
        toolCalling: true,
        listModels: false,
        embeddings: false,
        routingPreference: name === 'openrouter' && hubAceita,
      },
    }) as unknown as LLMProvider,
};
const useCase = new SetModelBindingUseCase(
  new DrizzleModelBindingRepository(db),
  modelRepo,
  workspaceModelRepo,
  new DrizzleProjectRepository(db),
  registry,
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
  hubAceita = false;
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

describe('SetModelBindingUseCase — preferência de roteamento (ADR 0166, RN-583)', () => {
  async function comHub() {
    const base = await setup();
    const [doHub] = await db
      .insert(models)
      .values({
        provider: 'openrouter',
        name: '~deepseek/deepseek-v4-flash-latest',
        displayName: 'DeepSeek V4 Flash',
        supportsToolCalling: true,
      })
      .returning();
    await base.ativarNoWorkspace(doHub.id);
    await base.ativarNoWorkspace(base.comFerramentas.id);
    return { ...base, doHub };
  }

  it('caminho feliz: grava a preferência num binding de provider que declara a capability', async () => {
    hubAceita = true;
    const { user, project, doHub } = await comHub();

    const binding = await useCase.execute(
      'area',
      chaveDeArea(project.id, 'dev'),
      doHub.id,
      user.id,
      'throughput',
    );

    expect(binding.routingPreference).toBe('throughput');
  });

  it('falha: provider sem a capability recusa — e NADA é gravado', async () => {
    const { user, project, doHub } = await comHub();
    // `hubAceita = false`: o estado de produção enquanto o smoke não rodar.
    const scopeId = chaveDeAgente(project.id, 'dev-backend');

    await expect(
      useCase.execute('agent', scopeId, doHub.id, user.id, 'throughput'),
    ).rejects.toThrow(RoutingPreferenceNotSupportedError);
    expect(
      await new DrizzleModelBindingRepository(db).findOne('agent', scopeId),
    ).toBeNull();
  });

  it('campo AUSENTE preserva o critério gravado — a troca de modelo de sempre não o apaga', async () => {
    hubAceita = true;
    const { user, project, doHub } = await comHub();
    const scopeId = chaveDeAgente(project.id, 'po');
    await useCase.execute('agent', scopeId, doHub.id, user.id, 'latency');

    const regravado = await useCase.execute(
      'agent',
      scopeId,
      doHub.id,
      user.id,
    );

    expect(regravado.routingPreference).toBe('latency');
  });

  it('trocar para modelo de provider SEM a capability zera o critério em vez de recusar a troca', async () => {
    hubAceita = true;
    const { user, project, doHub, comFerramentas } = await comHub();
    const scopeId = chaveDeAgente(project.id, 'po');
    await useCase.execute('agent', scopeId, doHub.id, user.id, 'price');

    const trocado = await useCase.execute(
      'agent',
      scopeId,
      comFerramentas.id,
      user.id,
    );

    expect(trocado).toMatchObject({
      modelId: comFerramentas.id,
      routingPreference: null,
    });
  });

  it('`null` explícito limpa', async () => {
    hubAceita = true;
    const { user, project, doHub } = await comHub();
    const scopeId = chaveDeAgente(project.id, 'po');
    await useCase.execute('agent', scopeId, doHub.id, user.id, 'price');

    const limpo = await useCase.execute(
      'agent',
      scopeId,
      doHub.id,
      user.id,
      null,
    );

    expect(limpo.routingPreference).toBeNull();
  });
});
