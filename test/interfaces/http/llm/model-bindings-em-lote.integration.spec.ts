import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from 'vitest';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  models,
  projectMembers,
  projects,
  users,
  workspaceMembers,
  workspaces,
} from '../../../../src/db/schema';

import { ModelBindingsController } from '../../../../src/interfaces/http/llm/model-bindings.controller';
import { JwtAuthGuard } from '../../../../src/interfaces/http/auth/jwt-auth.guard';
import { RolesGuard } from '../../../../src/interfaces/http/iam/roles.guard';
import { ResolveEffectiveRoleUseCase } from '../../../../src/application/use-cases/iam/resolve-effective-role.use-case';
import { ResolveModelBindingUseCase } from '../../../../src/application/use-cases/llm/resolve-model-binding.use-case';
import {
  ResolveModelBindingsEmLoteUseCase,
  TETO_DE_CHAVES_NO_LOTE,
} from '../../../../src/application/use-cases/llm/resolve-model-bindings-em-lote.use-case';
import { SetModelBindingUseCase } from '../../../../src/application/use-cases/llm/set-model-binding.use-case';
import { GetModelBindingUseCase } from '../../../../src/application/use-cases/llm/get-model-binding.use-case';
import { ClearModelBindingUseCase } from '../../../../src/application/use-cases/llm/clear-model-binding.use-case';
import { ProjectRepository } from '../../../../src/application/ports/project-repository.port';
import { WorkspaceRepository } from '../../../../src/application/ports/workspace-repository.port';
import { UserRepository } from '../../../../src/application/ports/user-repository.port';
import { ModelBindingRepository } from '../../../../src/application/ports/model-binding-repository.port';
import { TokenVerifier } from '../../../../src/application/ports/token-verifier.port';
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';
import { DrizzleWorkspaceRepository } from '../../../../src/infrastructure/persistence/drizzle/workspace.repository';
import { DrizzleUserRepository } from '../../../../src/infrastructure/persistence/drizzle/user.repository';
import { DrizzleModelBindingRepository } from '../../../../src/infrastructure/persistence/drizzle/model-binding.repository';
import {
  chaveDeAgente,
  chaveDeArea,
} from '../../../../src/domain/llm/binding-scope-id';

/**
 * RN-654 (AT-334) — `GET /projects/:projectId/model-bindings/resolved`, o lote
 * dos bindings resolvidos, contra Postgres de verdade e com os DOIS guards
 * globais na ordem do `AppModule` (autenticação, depois papel).
 *
 * O que se prova: cada chave do lote é, byte a byte, a resposta da rota
 * individual; o papel mínimo é o mesmo delas (`viewer`); e chave malformada ou
 * lote acima do teto são 400, nunca descarte calado.
 */

const { db, pool } = createTestDb();
const bindingRepo = new DrizzleModelBindingRepository(db);

describe('GET /projects/:projectId/model-bindings/resolved (RN-654)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    await truncateAll(db);

    const projectRepo = new DrizzleProjectRepository(db);
    const moduleRef = await Test.createTestingModule({
      controllers: [ModelBindingsController],
      providers: [
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        ResolveEffectiveRoleUseCase,
        ResolveModelBindingUseCase,
        ResolveModelBindingsEmLoteUseCase,
        { provide: ProjectRepository, useValue: projectRepo },
        {
          provide: WorkspaceRepository,
          useValue: new DrizzleWorkspaceRepository(db),
        },
        { provide: UserRepository, useValue: new DrizzleUserRepository(db) },
        { provide: ModelBindingRepository, useValue: bindingRepo },
        // O "JWT" do teste é o próprio id do usuário: o que se exercita aqui é
        // o papel, não a assinatura do token.
        {
          provide: TokenVerifier,
          useValue: {
            verify: vi.fn((token: string) => Promise.resolve({ sub: token })),
          },
        },
        // As rotas de escrita do controller não são chamadas aqui.
        { provide: SetModelBindingUseCase, useValue: {} },
        { provide: GetModelBindingUseCase, useValue: {} },
        { provide: ClearModelBindingUseCase, useValue: {} },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seed() {
    const [dono] = await db
      .insert(users)
      .values({ email: 'dono-lote@brabo.dev' })
      .returning();
    const [ws] = await db
      .insert(workspaces)
      .values({ name: 'acme', slug: 'acme', createdBy: dono.id })
      .returning();
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: ws.id, userId: dono.id, role: 'owner' });
    const [project] = await db
      .insert(projects)
      .values({
        workspaceId: ws.id,
        name: 'core',
        slug: 'core',
        workspaceDirName: 'core-lote-de-bindings',
        createdBy: dono.id,
      })
      .returning();
    const [leitor] = await db
      .insert(users)
      .values({ email: 'leitor-lote@brabo.dev' })
      .returning();
    await db
      .insert(projectMembers)
      .values({ projectId: project.id, userId: leitor.id, role: 'viewer' });
    const [estranho] = await db
      .insert(users)
      .values({ email: 'estranho-lote@brabo.dev' })
      .returning();

    const [doWorkspace, daArea, doAgente] = await db
      .insert(models)
      .values([
        { provider: 'ollama', name: 'm-ws', displayName: 'WS' },
        { provider: 'ollama', name: 'm-area', displayName: 'Área' },
        { provider: 'ollama', name: 'm-agente', displayName: 'Agente' },
      ])
      .returning();
    await bindingRepo.upsert({
      scope: 'workspace',
      scopeId: ws.id,
      modelId: doWorkspace.id,
      createdBy: dono.id,
    });
    await bindingRepo.upsert({
      scope: 'area',
      scopeId: chaveDeArea(project.id, 'qa'),
      modelId: daArea.id,
      createdBy: dono.id,
    });
    await bindingRepo.upsert({
      scope: 'agent',
      scopeId: chaveDeAgente(project.id, 'arquiteto'),
      modelId: doAgente.id,
      createdBy: dono.id,
    });

    return { project, leitor, estranho, doWorkspace, daArea, doAgente };
  }

  const pedir = (url: string, userId: string) =>
    request(app.getHttpServer() as App)
      .get(url)
      .set('Authorization', `Bearer ${userId}`);

  it('caminho feliz: viewer lê agentes e áreas numa chamada, e cada chave é a resposta da rota individual', async () => {
    const { project, leitor, doWorkspace, daArea, doAgente } = await seed();

    const resposta = await pedir(
      `/projects/${project.id}/model-bindings/resolved` +
        '?agents=arquiteto,qa-automacao,po,arquiteto&areas=qa,dev',
      leitor.id,
    );

    expect(resposta.status).toBe(200);
    const corpo = resposta.body as {
      agents: { key: string; binding: { modelId: string; origin: string } }[];
      areas: { key: string; binding: { modelId: string; origin: string } }[];
    };
    // Na ordem pedida, e a repetição de `arquiteto` não vira duas linhas.
    expect(corpo.agents.map((a) => a.key)).toEqual([
      'arquiteto',
      'qa-automacao',
      'po',
    ]);
    expect(corpo.agents[0].binding).toMatchObject({
      modelId: doAgente.id,
      origin: 'agent',
    });
    // Subagente de QA herda o padrão da ÁREA — a cascata passa pela área
    // que sai do catálogo, como na rota individual.
    expect(corpo.agents[1].binding).toMatchObject({
      modelId: daArea.id,
      origin: 'area',
    });
    expect(corpo.areas).toEqual([
      {
        key: 'qa',
        binding: expect.objectContaining({
          modelId: daArea.id,
          origin: 'area',
        }) as unknown,
      },
      {
        key: 'dev',
        binding: expect.objectContaining({
          modelId: doWorkspace.id,
          origin: 'workspace',
        }) as unknown,
      },
    ]);

    // Byte a byte o que as rotas individuais respondem para as mesmas chaves.
    for (const { key, binding } of corpo.agents) {
      const individual = await pedir(
        `/projects/${project.id}/agent-bindings/${key}`,
        leitor.id,
      );
      expect(individual.body).toEqual(binding);
    }
    for (const { key, binding } of corpo.areas) {
      const individual = await pedir(
        `/projects/${project.id}/area-bindings/${key}`,
        leitor.id,
      );
      expect(individual.body).toEqual(binding);
    }
  });

  it('sem nenhuma chave, responde as duas listas vazias', async () => {
    const { project, leitor } = await seed();
    const resposta = await pedir(
      `/projects/${project.id}/model-bindings/resolved`,
      leitor.id,
    );
    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({ agents: [], areas: [] });
  });

  it('CASO DE FALHA: quem não tem papel no projeto recebe 403, como nas rotas individuais', async () => {
    const { project, estranho } = await seed();

    const lote = await pedir(
      `/projects/${project.id}/model-bindings/resolved?agents=arquiteto`,
      estranho.id,
    );
    const individual = await pedir(
      `/projects/${project.id}/agent-bindings/arquiteto`,
      estranho.id,
    );

    expect(lote.status).toBe(403);
    expect(individual.status).toBe(403);
    expect((lote.body as { message: unknown }).message).toBe(
      (individual.body as { message: unknown }).message,
    );
  });

  it('CASO DE FALHA: chave malformada é 400 nomeando a chave, nunca descartada calada', async () => {
    const { project, leitor } = await seed();

    const resposta = await pedir(
      `/projects/${project.id}/model-bindings/resolved?agents=arquiteto,x:y`,
      leitor.id,
    );

    expect(resposta.status).toBe(400);
    expect((resposta.body as { message: string }).message).toContain('"x:y"');
  });

  it('CASO DE FALHA: lote acima do teto é 400 dizendo o teto', async () => {
    const { project, leitor } = await seed();
    const chaves = Array.from(
      { length: TETO_DE_CHAVES_NO_LOTE + 1 },
      (_, i) => `dev-mod${i}`,
    );

    const resposta = await pedir(
      `/projects/${project.id}/model-bindings/resolved?agents=${chaves.join(',')}`,
      leitor.id,
    );

    expect(resposta.status).toBe(400);
    expect((resposta.body as { message: string }).message).toContain(
      String(TETO_DE_CHAVES_NO_LOTE),
    );
  });
});
