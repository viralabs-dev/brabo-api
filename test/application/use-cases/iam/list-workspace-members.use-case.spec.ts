import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { Reflector } from '@nestjs/core';
import {
  ForbiddenException,
  NotFoundException,
  type ExecutionContext,
} from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { users, workspaceMembers, workspaces } from '../../../../src/db/schema';
import { DrizzleWorkspaceRepository } from '../../../../src/infrastructure/persistence/drizzle/workspace.repository';
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';
import { ListWorkspaceMembersUseCase } from '../../../../src/application/use-cases/iam/list-workspace-members.use-case';
import { ResolveEffectiveRoleUseCase } from '../../../../src/application/use-cases/iam/resolve-effective-role.use-case';
import { RolesGuard } from '../../../../src/interfaces/http/iam/roles.guard';
import { REQUIRED_ROLE_KEY } from '../../../../src/interfaces/http/iam/require-role.decorator';
import { WorkspacesController } from '../../../../src/interfaces/http/iam/workspaces.controller';

/**
 * `GET /workspaces/:workspaceId/members` (AT-335, RN-652): a leitura que
 * deixa o fio da sessão NOMEAR quem entra no projeto só pelo papel de
 * workspace. Contra Postgres de verdade — a forma da resposta é o que o
 * JOIN devolve, e é ela que precisa ter só id, nome, e-mail e papel.
 */

const { db, pool } = createTestDb();
const workspaceRepo = new DrizzleWorkspaceRepository(db);
const listar = new ListWorkspaceMembersUseCase(workspaceRepo);
const guard = new RolesGuard(
  new Reflector(),
  new ResolveEffectiveRoleUseCase(
    new DrizzleProjectRepository(db),
    workspaceRepo,
  ),
);

async function criarUsuario(email: string, name: string | null = email) {
  const [row] = await db
    .insert(users)
    .values({ keycloakSub: `sub-${email}`, email, name })
    .returning();
  return row;
}

async function criarWorkspace(ownerId: string, slug: string) {
  const [row] = await db
    .insert(workspaces)
    .values({ name: slug, slug, createdBy: ownerId })
    .returning();
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: row.id, userId: ownerId, role: 'owner' });
  return row;
}

/** O contexto do guard sobre o handler REAL — o metadado é o da rota. */
function contextoDaRota(userId: string, workspaceId: string): ExecutionContext {
  const request = { user: { id: userId }, params: { workspaceId } };
  return {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    getHandler: () => WorkspacesController.prototype.listMembers,
    getClass: () => WorkspacesController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('ListWorkspaceMembersUseCase', () => {
  it('caminho feliz: lista os membros do workspace com id, nome, e-mail e papel — e nada além', async () => {
    const dono = await criarUsuario('dona@brabo.dev', 'Dona');
    const leitor = await criarUsuario('leitor@brabo.dev', null);
    const ws = await criarWorkspace(dono.id, 'acme');
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: ws.id, userId: leitor.id, role: 'viewer' });
    // Membro de OUTRO workspace não vaza para este.
    const outro = await criarUsuario('outro@brabo.dev');
    await criarWorkspace(outro.id, 'outro');

    const membros = await listar.execute(ws.id);

    expect(
      [...membros].sort((a, b) => a.email.localeCompare(b.email)),
    ).toEqual([
      { userId: dono.id, role: 'owner', name: 'Dona', email: 'dona@brabo.dev' },
      { userId: leitor.id, role: 'viewer', name: null, email: 'leitor@brabo.dev' },
    ]);
  });

  it('recusa: workspace inexistente é 404', async () => {
    await expect(
      listar.execute('00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('GET /workspaces/:workspaceId/members — o papel mínimo', () => {
  it('é `viewer`, o das leituras vizinhas, e não o `owner` das escritas de membro', () => {
    const reflector = new Reflector();
    expect(
      // eslint-disable-next-line @typescript-eslint/unbound-method
      reflector.get(REQUIRED_ROLE_KEY, WorkspacesController.prototype.listMembers),
    ).toBe('viewer');
  });

  it('um `viewer` do workspace passa pelo guard', async () => {
    const dono = await criarUsuario('dona2@brabo.dev');
    const leitor = await criarUsuario('leitor2@brabo.dev');
    const ws = await criarWorkspace(dono.id, 'acme2');
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: ws.id, userId: leitor.id, role: 'viewer' });

    await expect(
      guard.canActivate(contextoDaRota(leitor.id, ws.id)),
    ).resolves.toBe(true);
  });

  it('recusa: quem não é membro do workspace recebe 403 do guard', async () => {
    const dono = await criarUsuario('dona3@brabo.dev');
    const estranho = await criarUsuario('estranho@brabo.dev');
    const ws = await criarWorkspace(dono.id, 'acme3');

    await expect(
      guard.canActivate(contextoDaRota(estranho.id, ws.id)),
    ).rejects.toThrow(ForbiddenException);
  });
});
