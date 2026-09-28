import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  personalAccessTokens,
  projectMembers,
  projects,
  runnerDeviceKeys,
  users,
  workspaceMembers,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';
import { DrizzleWorkspaceRepository } from '../../../../src/infrastructure/persistence/drizzle/workspace.repository';
import { DrizzleRunnerDeviceKeyRepository } from '../../../../src/infrastructure/persistence/drizzle/runner-device-key.repository';
import { DrizzlePersonalAccessTokenRepository } from '../../../../src/infrastructure/persistence/drizzle/personal-access-token.repository';
import { DrizzleUnitOfWork } from '../../../../src/infrastructure/persistence/drizzle/drizzle-unit-of-work';
import type { DrizzleDb } from '../../../../src/infrastructure/persistence/drizzle/drizzle-client';
import {
  MOTIVO_REVOGACAO_POR_REMOCAO_DO_WORKSPACE,
  RemoveWorkspaceMemberUseCase,
} from '../../../../src/application/use-cases/iam/remove-workspace-member.use-case';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import {
  MENSAGEM_TETO_AUTO_REBAIXAMENTO_NO_WORKSPACE,
  MENSAGEM_TETO_AUTO_REMOCAO_DO_WORKSPACE,
} from '../../../../src/domain/iam/tetos-de-rebaixamento';

/**
 * A quinta porta da linha dos tetos (ADR 0173, RN-615): a remoção de membro de
 * WORKSPACE, contra o Postgres de verdade — a cascata é SQL, e é ela que torna
 * a remoção real em vez de cosmética.
 */
const { db, pool } = createTestDb();
const drizzleDb = db as unknown as DrizzleDb;
const projectRepo = new DrizzleProjectRepository(drizzleDb);
const workspaceRepo = new DrizzleWorkspaceRepository(drizzleDb);
const deviceKeyRepo = new DrizzleRunnerDeviceKeyRepository(drizzleDb);
const patRepo = new DrizzlePersonalAccessTokenRepository(drizzleDb);
const uow = new DrizzleUnitOfWork(drizzleDb);

function novoEngine() {
  const disconnectRunnerOfUser = vi.fn(() => Promise.resolve('sem_runner'));
  return {
    disconnectRunnerOfUser,
    engine: { disconnectRunnerOfUser } as unknown as ApiToEngineClient,
  };
}

function novoCaso(engine: ApiToEngineClient) {
  return new RemoveWorkspaceMemberUseCase(
    workspaceRepo,
    projectRepo,
    deviceKeyRepo,
    patRepo,
    uow,
    engine,
  );
}

async function createUser(email: string) {
  const [row] = await db
    .insert(users)
    .values({ keycloakSub: `sub-${email}`, email, name: email })
    .returning();
  return row;
}

async function createWorkspace(ownerId: string, slug: string) {
  const [row] = await db
    .insert(workspaces)
    .values({ name: slug, slug, createdBy: ownerId })
    .returning();
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: row.id, userId: ownerId, role: 'owner' });
  return row;
}

async function addToWorkspace(
  workspaceId: string,
  userId: string,
  role: 'owner' | 'maintainer' | 'developer' | 'viewer',
) {
  await db.insert(workspaceMembers).values({ workspaceId, userId, role });
}

async function createProject(
  workspaceId: string,
  ownerId: string,
  slug: string,
) {
  const [row] = await db
    .insert(projects)
    .values({
      workspaceId,
      name: slug,
      slug,
      createdBy: ownerId,
      workspaceDirName: `${slug}-${workspaceId.slice(0, 8)}`,
    })
    .returning();
  return row;
}

async function createKey(userId: string, projectId: string | null) {
  const [row] = await db
    .insert(runnerDeviceKeys)
    .values({ userId, projectId, name: 'notebook', publicKeyJwk: '{}' })
    .returning();
  return row;
}

async function createPat(userId: string, projectId: string) {
  const [row] = await db
    .insert(personalAccessTokens)
    .values({ userId, projectId, name: 'ci', tokenHash: `hash-${projectId}` })
    .returning();
  return row;
}

async function pat(id: string) {
  const [row] = await db
    .select()
    .from(personalAccessTokens)
    .where(eq(personalAccessTokens.id, id));
  return row;
}

async function key(id: string) {
  const [row] = await db
    .select()
    .from(runnerDeviceKeys)
    .where(eq(runnerDeviceKeys.id, id));
  return row;
}

async function owners(workspaceId: string) {
  return db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.role, 'owner'),
      ),
    );
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('RemoveWorkspaceMemberUseCase — remover OUTRA pessoa', () => {
  it('remove a linha de workspace, as de projeto DESTE workspace e as chaves de projeto dele aqui', async () => {
    const dono = await createUser('rw-dono1@brabo.dev');
    const dev = await createUser('rw-dev1@brabo.dev');
    const workspace = await createWorkspace(dono.id, 'rw-acme');
    const outroWs = await createWorkspace(dono.id, 'rw-outro');
    const core = await createProject(workspace.id, dono.id, 'core');
    const web = await createProject(workspace.id, dono.id, 'web');
    const alheio = await createProject(outroWs.id, dono.id, 'alheio');
    await addToWorkspace(workspace.id, dev.id, 'developer');
    await addToWorkspace(outroWs.id, dev.id, 'developer');
    // A linha de projeto que manteria o removido dentro de `core` pela
    // sobreposição (RN-471), e uma no OUTRO workspace, que não é tocada.
    await db.insert(projectMembers).values([
      { projectId: core.id, userId: dev.id, role: 'maintainer' },
      { projectId: alheio.id, userId: dev.id, role: 'maintainer' },
    ]);
    const chaveDeCore = await createKey(dev.id, core.id);
    const chaveAlheia = await createKey(dev.id, alheio.id);
    const chaveDeMaquina = await createKey(dev.id, null);
    const patDeCore = await createPat(dev.id, core.id);
    const patAlheio = await createPat(dev.id, alheio.id);

    const { engine, disconnectRunnerOfUser } = novoEngine();
    await novoCaso(engine).execute(workspace.id, dono.id, dev.id);

    expect(await workspaceRepo.findMemberRole(workspace.id, dev.id)).toBeNull();
    expect(await projectRepo.findMemberRole(core.id, dev.id)).toBeNull();
    // Fora do workspace, nada muda.
    expect(await workspaceRepo.findMemberRole(outroWs.id, dev.id)).toBe(
      'developer',
    );
    expect(await projectRepo.findMemberRole(alheio.id, dev.id)).toBe(
      'maintainer',
    );

    const revogada = await key(chaveDeCore.id);
    expect(revogada.revokedAt).not.toBeNull();
    expect(revogada.revokedReason).toBe(
      MOTIVO_REVOGACAO_POR_REMOCAO_DO_WORKSPACE,
    );
    expect((await key(chaveAlheia.id)).revokedAt).toBeNull();
    // A de MÁQUINA é da conta e serve o outro workspace: fica.
    expect((await key(chaveDeMaquina.id)).revokedAt).toBeNull();
    // Todo PAT é de UM projeto: o daqui cai, o do outro workspace fica.
    expect((await pat(patDeCore.id)).revokedReason).toBe(
      MOTIVO_REVOGACAO_POR_REMOCAO_DO_WORKSPACE,
    );
    expect((await pat(patAlheio.id)).revokedAt).toBeNull();

    // A conexão viva cai em TODO projeto do workspace, e só nele.
    const alvos = disconnectRunnerOfUser.mock.calls.map((c) => c as unknown[]);
    expect(alvos).toHaveLength(2);
    expect(alvos).toEqual(
      expect.arrayContaining([
        [core.id, dev.id],
        [web.id, dev.id],
      ]),
    );
  });

  it('remove OUTRO owner — é a forma de revogar propriedade (ADR 0157, ponto 3)', async () => {
    const dono = await createUser('rw-dono2@brabo.dev');
    const outro = await createUser('rw-dono2b@brabo.dev');
    const workspace = await createWorkspace(dono.id, 'rw-globex');
    await addToWorkspace(workspace.id, outro.id, 'owner');

    await novoCaso(novoEngine().engine).execute(
      workspace.id,
      dono.id,
      outro.id,
    );

    expect(
      await workspaceRepo.findMemberRole(workspace.id, outro.id),
    ).toBeNull();
    expect(await owners(workspace.id)).toHaveLength(1);
  });

  it('o engine fora do ar não derruba a remoção: a desconexão é efeito colateral', async () => {
    const dono = await createUser('rw-dono3@brabo.dev');
    const dev = await createUser('rw-dev3@brabo.dev');
    const workspace = await createWorkspace(dono.id, 'rw-initech');
    await createProject(workspace.id, dono.id, 'core');
    await addToWorkspace(workspace.id, dev.id, 'developer');
    const engine = {
      disconnectRunnerOfUser: vi.fn(() =>
        Promise.reject(new Error('ECONNREFUSED')),
      ),
    } as unknown as ApiToEngineClient;

    await expect(
      novoCaso(engine).execute(workspace.id, dono.id, dev.id),
    ).resolves.toBeUndefined();
    expect(await workspaceRepo.findMemberRole(workspace.id, dev.id)).toBeNull();
  });

  it('remover quem não é membro é idempotente, sem erro', async () => {
    const dono = await createUser('rw-dono4@brabo.dev');
    const estranho = await createUser('rw-estranho4@brabo.dev');
    const workspace = await createWorkspace(dono.id, 'rw-hooli');

    await expect(
      novoCaso(novoEngine().engine).execute(workspace.id, dono.id, estranho.id),
    ).resolves.toBeUndefined();
    expect(await owners(workspace.id)).toHaveLength(1);
  });
});

describe('RemoveWorkspaceMemberUseCase — o teto 2 pela quinta porta', () => {
  it('recusa (403) a remoção de SI MESMO, mesmo havendo outro owner — a cláusula não conta', async () => {
    const dono = await createUser('rw-dono5@brabo.dev');
    const outro = await createUser('rw-dono5b@brabo.dev');
    const workspace = await createWorkspace(dono.id, 'rw-stark');
    await addToWorkspace(workspace.id, outro.id, 'owner');
    const core = await createProject(workspace.id, dono.id, 'core');
    await db
      .insert(projectMembers)
      .values({ projectId: core.id, userId: dono.id, role: 'owner' });
    const chave = await createKey(dono.id, core.id);
    const { engine, disconnectRunnerOfUser } = novoEngine();

    await expect(
      novoCaso(engine).execute(workspace.id, dono.id, dono.id),
    ).rejects.toThrow(MENSAGEM_TETO_AUTO_REMOCAO_DO_WORKSPACE);

    // Nada foi escrito, e nada foi derrubado.
    expect(await workspaceRepo.findMemberRole(workspace.id, dono.id)).toBe(
      'owner',
    );
    expect(await projectRepo.findMemberRole(core.id, dono.id)).toBe('owner');
    expect((await key(chave.id)).revokedAt).toBeNull();
    expect(disconnectRunnerOfUser).not.toHaveBeenCalled();
  });

  it('a mensagem é PRÓPRIA da remoção, não a de rebaixamento do workspace', async () => {
    const dono = await createUser('rw-dono6@brabo.dev');
    const workspace = await createWorkspace(dono.id, 'rw-wayne');

    const tentativa = novoCaso(novoEngine().engine).execute(
      workspace.id,
      dono.id,
      dono.id,
    );
    await expect(tentativa).rejects.toThrow(ForbiddenException);
    await expect(tentativa).rejects.not.toThrow(
      MENSAGEM_TETO_AUTO_REBAIXAMENTO_NO_WORKSPACE,
    );
  });

  it('recusa também um não-owner removendo a si mesmo — o teto não depende do papel', async () => {
    // Inalcançável pela rota (`@RequireRole('owner')`), e aplicado mesmo
    // assim: o caso de uso não presume o guard.
    const dono = await createUser('rw-dono7@brabo.dev');
    const dev = await createUser('rw-dev7@brabo.dev');
    const workspace = await createWorkspace(dono.id, 'rw-umbrella');
    await addToWorkspace(workspace.id, dev.id, 'developer');

    await expect(
      novoCaso(novoEngine().engine).execute(workspace.id, dev.id, dev.id),
    ).rejects.toThrow(MENSAGEM_TETO_AUTO_REMOCAO_DO_WORKSPACE);
  });
});

describe('RemoveWorkspaceMemberUseCase — o último owner não sai (pela cláusula, sem contar)', () => {
  it('o owner ÚNICO não consegue se remover', async () => {
    const dono = await createUser('rw-dono8@brabo.dev');
    const workspace = await createWorkspace(dono.id, 'rw-tyrell');

    await expect(
      novoCaso(novoEngine().engine).execute(workspace.id, dono.id, dono.id),
    ).rejects.toThrow(ForbiddenException);

    expect(await owners(workspace.id)).toHaveLength(1);
  });

  it('com dois owners, qualquer sequência de remoções deixa ao menos um: quem remove fica', async () => {
    const a = await createUser('rw-dono9a@brabo.dev');
    const b = await createUser('rw-dono9b@brabo.dev');
    const workspace = await createWorkspace(a.id, 'rw-cyberdyne');
    await addToWorkspace(workspace.id, b.id, 'owner');
    const caso = novoCaso(novoEngine().engine);

    // B remove A — passa, e B é quem sobra.
    await caso.execute(workspace.id, b.id, a.id);
    expect((await owners(workspace.id)).map((o) => o.userId)).toEqual([b.id]);

    // B é o último, e o único ator capaz de removê-lo é ele mesmo: recusado.
    await expect(caso.execute(workspace.id, b.id, b.id)).rejects.toThrow(
      MENSAGEM_TETO_AUTO_REMOCAO_DO_WORKSPACE,
    );
    expect((await owners(workspace.id)).map((o) => o.userId)).toEqual([b.id]);
  });
});
