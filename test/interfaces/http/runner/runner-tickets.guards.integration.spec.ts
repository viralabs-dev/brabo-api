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
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  users,
  workspaces,
  projects,
  projectMembers,
} from '../../../../src/db/schema';
import type { Role } from '../../../../src/domain/iam/role';

import { RunnerTicketsController } from '../../../../src/interfaces/http/runner/runner-tickets.controller';
import { JwtAuthGuard } from '../../../../src/interfaces/http/auth/jwt-auth.guard';
import { RolesGuard } from '../../../../src/interfaces/http/iam/roles.guard';
import { PatAuthGuard } from '../../../../src/interfaces/http/auth/pat-auth.guard';

import { RequestRunnerTicketUseCase } from '../../../../src/application/use-cases/runner/request-runner-ticket.use-case';
import { ResolveEffectiveRoleUseCase } from '../../../../src/application/use-cases/iam/resolve-effective-role.use-case';
import { TokenFactory } from '../../../../src/application/use-cases/auth/token-factory';
import { ProjectRepository } from '../../../../src/application/ports/project-repository.port';
import { WorkspaceRepository } from '../../../../src/application/ports/workspace-repository.port';
import { UserRepository } from '../../../../src/application/ports/user-repository.port';
import { PersonalAccessTokenRepository } from '../../../../src/application/ports/personal-access-token-repository.port';
import { RunnerDeviceKeyRepository } from '../../../../src/application/ports/runner-device-key-repository.port';
import { TokenVerifier } from '../../../../src/application/ports/token-verifier.port';
import { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';

import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';
import { DrizzleWorkspaceRepository } from '../../../../src/infrastructure/persistence/drizzle/workspace.repository';
import { DrizzleUserRepository } from '../../../../src/infrastructure/persistence/drizzle/user.repository';
import { DrizzlePersonalAccessTokenRepository } from '../../../../src/infrastructure/persistence/drizzle/personal-access-token.repository';

/**
 * RN-439: `POST /projects/:projectId/runner-ticket` sempre respondia 403
 * "Não autenticado", mesmo com um Personal Access Token válido — achado
 * numa verificação AO VIVO do runner conectando a um projeto real, nunca
 * por teste automatizado.
 *
 * Causa raiz: `JwtAuthGuard` e `RolesGuard` são os dois `APP_GUARD`
 * (globais) e rodam ANTES de `PatAuthGuard` (local, `@UseGuards` na rota) —
 * ordem do Nest, não configurável pelos decorators do controller.
 * `JwtAuthGuard` já sabia se abster em rota `@RequirePatAuth()`; `RolesGuard`
 * não sabia, e recusava toda chamada com `request.user` ainda vazio antes de
 * `PatAuthGuard` sequer rodar.
 *
 * Este é o teste que faltava: `pat-auth.guard.spec.ts` e `roles.guard.spec.ts`
 * sempre testaram cada guard ISOLADO — nunca os dois juntos, na mesma
 * requisição, na mesma ordem que o Nest de fato aplica. Sobe um Nest de
 * verdade (`Test.createTestingModule` + `createNestApplication`), com os
 * `APP_GUARD` na mesma posição relativa de `AuthHttpModule`/`IamHttpModule`
 * no `AppModule` real (`JwtAuthGuard` antes de `RolesGuard`), e bate com
 * `supertest` — é o único jeito de o bug de ordenação aparecer.
 */

const PROJECT_ID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';

const { db, pool } = createTestDb();
const tokenFactory = new TokenFactory();
const patRepo = new DrizzlePersonalAccessTokenRepository(db);

describe('runner-ticket — JwtAuthGuard + RolesGuard + PatAuthGuard juntos (RN-439)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    await truncateAll(db);

    const moduleRef = await Test.createTestingModule({
      controllers: [RunnerTicketsController],
      providers: [
        // MESMA ordem relativa de app.module.ts: JwtAuthGuard
        // (AuthHttpModule) antes de RolesGuard (IamHttpModule) — é essa
        // ordem que faz o bug original aparecer sem o desvio na RolesGuard.
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        PatAuthGuard,
        RequestRunnerTicketUseCase,
        ResolveEffectiveRoleUseCase,
        {
          provide: ProjectRepository,
          useValue: new DrizzleProjectRepository(db),
        },
        {
          provide: WorkspaceRepository,
          useValue: new DrizzleWorkspaceRepository(db),
        },
        { provide: UserRepository, useValue: new DrizzleUserRepository(db) },
        { provide: PersonalAccessTokenRepository, useValue: patRepo },
        // Nunca chamado nestes cenários — nenhum aqui usa credencial de
        // chave de dispositivo — presente só porque o construtor do guard
        // exige o port desde que ele passou a aceitar as DUAS formas.
        {
          provide: RunnerDeviceKeyRepository,
          useValue: {
            buscarChavePublicaAtiva: vi.fn().mockResolvedValue(null),
            tocarUso: vi.fn(),
          },
        },
        // Nunca chamado nesta rota (`@RequirePatAuth()` faz `JwtAuthGuard`
        // se abster antes de tentar verificar JWT) — presente só porque o
        // construtor do guard exige o port.
        { provide: TokenVerifier, useValue: { verify: vi.fn() } },
        {
          provide: ApiToEngineClient,
          useValue: {
            requestRunnerTicket: vi.fn().mockResolvedValue({
              ticket: 'ticket-bruto',
              expiresAt: new Date('2026-08-22T12:00:30.000Z'),
            }),
          },
        },
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

  let seedCounter = 0;

  async function seed(opcoes: { papelDoDev?: Role | null } = {}) {
    const sufixo = `${Date.now()}-${seedCounter++}`;
    const [dono] = await db
      .insert(users)
      .values({ email: `dono-${sufixo}@brabo.dev` })
      .returning();
    const [ws] = await db
      .insert(workspaces)
      .values({
        name: `acme-${sufixo}`,
        slug: `acme-${sufixo}`,
        createdBy: dono.id,
      })
      .returning();
    const [project] = await db
      .insert(projects)
      .values({
        workspaceId: ws.id,
        name: `core-${sufixo}`,
        slug: `core-${sufixo}`,
        workspaceDirName: `core-runner-guard-test-${sufixo}`,
        createdBy: dono.id,
        executionMode: 'runner',
        workspacePath: '/home/dono/core',
      })
      .returning();

    const [dev] = await db
      .insert(users)
      .values({ email: `dev-${sufixo}@brabo.dev` })
      .returning();

    if (opcoes.papelDoDev !== null) {
      await db.insert(projectMembers).values({
        projectId: project.id,
        userId: dev.id,
        role: opcoes.papelDoDev ?? 'developer',
      });
    }

    return { dono, project, dev };
  }

  async function emitirPat(userId: string, projectId: string) {
    const { bruto } = tokenFactory.gerar();
    const token = `brb_${bruto}`;
    await patRepo.emitir({
      userId,
      projectId,
      name: 'laptop',
      tokenHash: tokenFactory.hashDe(token),
      expiresAt: null,
    });
    return token;
  }

  it('caminho feliz: PAT válido e papel developer → 201, não 403', async () => {
    const { project, dev } = await seed({ papelDoDev: 'developer' });
    const token = await emitirPat(dev.id, project.id);

    const resposta = await request(app.getHttpServer())
      .post(`/projects/${project.id}/runner-ticket`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(resposta.status).toBe(201);
    expect(resposta.body).toMatchObject({
      ticket: 'ticket-bruto',
      expiresAt: '2026-08-22T12:00:30.000Z',
    });
  });

  it('PAT válido, mas o dono do token NÃO tem papel developer no projeto (viewer): 403 "Papel insuficiente"', async () => {
    const { project, dev } = await seed({ papelDoDev: 'viewer' });
    const token = await emitirPat(dev.id, project.id);

    const resposta = await request(app.getHttpServer())
      .post(`/projects/${project.id}/runner-ticket`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(resposta.status).toBe(403);
    expect(resposta.body.message).toBe('Papel insuficiente para esta ação');
  });

  it('PAT válido, dono do token SEM nenhum vínculo com o projeto: 403 "Papel insuficiente"', async () => {
    const { project, dev } = await seed({ papelDoDev: null });
    const token = await emitirPat(dev.id, project.id);

    const resposta = await request(app.getHttpServer())
      .post(`/projects/${project.id}/runner-ticket`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(resposta.status).toBe(403);
    expect(resposta.body.message).toBe('Papel insuficiente para esta ação');
  });

  it('PAT válido, mas para OUTRO projeto: continua 403 "Token não autorizado para este projeto"', async () => {
    const { project: projetoDoToken, dev } = await seed({
      papelDoDev: 'developer',
    });
    const { project: outroProjeto } = await seed({ papelDoDev: 'developer' });
    const token = await emitirPat(dev.id, projetoDoToken.id);

    const resposta = await request(app.getHttpServer())
      .post(`/projects/${outroProjeto.id}/runner-ticket`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(resposta.status).toBe(403);
    expect(resposta.body.message).toBe(
      'Token não autorizado para este projeto',
    );
  });

  it('token ausente: continua 401', async () => {
    const resposta = await request(app.getHttpServer())
      .post(`/projects/${PROJECT_ID_INEXISTENTE}/runner-ticket`)
      .send();

    expect(resposta.status).toBe(401);
  });

  it('token inválido (não é brb_...): continua 401', async () => {
    const resposta = await request(app.getHttpServer())
      .post(`/projects/${PROJECT_ID_INEXISTENTE}/runner-ticket`)
      .set('Authorization', 'Bearer nao-e-um-pat')
      .send();

    expect(resposta.status).toBe(401);
  });
});
