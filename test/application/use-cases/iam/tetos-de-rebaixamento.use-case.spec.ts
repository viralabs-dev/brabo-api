import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  projectMembers,
  projects,
  users,
  workspaceMembers,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';
import { DrizzleWorkspaceRepository } from '../../../../src/infrastructure/persistence/drizzle/workspace.repository';
import { AddProjectMemberUseCase } from '../../../../src/application/use-cases/iam/add-project-member.use-case';
import { RemoveProjectMemberUseCase } from '../../../../src/application/use-cases/iam/remove-project-member.use-case';
import { ResolveEffectiveRoleUseCase } from '../../../../src/application/use-cases/iam/resolve-effective-role.use-case';

/**
 * Os DOIS tetos de rebaixamento (ADR 0127, RN-472) e a capacidade que eles NÃO
 * podem levar junto: a sobreposição continua valendo nos dois sentidos.
 */
const { db, pool } = createTestDb();
const projectRepo = new DrizzleProjectRepository(db);
const workspaceRepo = new DrizzleWorkspaceRepository(db);
const resolveEffectiveRole = new ResolveEffectiveRoleUseCase(
  projectRepo,
  workspaceRepo,
);
const addProjectMember = new AddProjectMemberUseCase(
  projectRepo,
  workspaceRepo,
  resolveEffectiveRole,
);
const removeProjectMember = new RemoveProjectMemberUseCase(projectRepo);

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

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('Teto 1 — ninguém rebaixa o owner do workspace', () => {
  it('recusa (403) um maintainer pondo o owner do workspace como viewer no projeto', async () => {
    const dono = await createUser('dono@brabo.dev');
    const mant = await createUser('mant@brabo.dev');
    const workspace = await createWorkspace(dono.id, 'acme');
    const project = await createProject(workspace.id, dono.id, 'core');
    await db.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: mant.id,
      role: 'maintainer',
    });

    await expect(
      addProjectMember.execute(project.id, mant.id, dono.id, 'viewer'),
    ).rejects.toThrow(ForbiddenException);

    // Nada foi gravado: o dono continua sem linha de projeto, e o efetivo
    // dele segue sendo o `owner` do workspace.
    expect(await resolveEffectiveRole.forProject(dono.id, project.id)).toBe(
      'owner',
    );
  });

  it('deixa passar quando o papel pedido para o owner do workspace é owner (redundante, não rebaixa)', async () => {
    const dono = await createUser('dono2@brabo.dev');
    const mant = await createUser('mant2@brabo.dev');
    const workspace = await createWorkspace(dono.id, 'globex');
    const project = await createProject(workspace.id, dono.id, 'core');
    await db.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: mant.id,
      role: 'maintainer',
    });

    await addProjectMember.execute(project.id, mant.id, dono.id, 'owner');

    expect(await projectRepo.findMemberRole(project.id, dono.id)).toBe('owner');
  });
});

describe('Teto 2 — ninguém rebaixa a si mesmo', () => {
  it('recusa (403) o maintainer que se põe como viewer no próprio projeto', async () => {
    const dono = await createUser('dono3@brabo.dev');
    const mant = await createUser('mant3@brabo.dev');
    const workspace = await createWorkspace(dono.id, 'initech');
    const project = await createProject(workspace.id, dono.id, 'core');
    await db.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: mant.id,
      role: 'maintainer',
    });

    await expect(
      addProjectMember.execute(project.id, mant.id, mant.id, 'viewer'),
    ).rejects.toThrow(ForbiddenException);

    expect(await resolveEffectiveRole.forProject(mant.id, project.id)).toBe(
      'maintainer',
    );
  });

  it('recusa também quando o papel do ator vem da LINHA DE PROJETO, não do workspace', async () => {
    const dono = await createUser('dono4@brabo.dev');
    const mant = await createUser('mant4@brabo.dev');
    const workspace = await createWorkspace(dono.id, 'hooli');
    const project = await createProject(workspace.id, dono.id, 'core');
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: workspace.id, userId: mant.id, role: 'viewer' });
    await db.insert(projectMembers).values({
      projectId: project.id,
      userId: mant.id,
      role: 'maintainer',
    });

    await expect(
      addProjectMember.execute(project.id, mant.id, mant.id, 'developer'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('subir o próprio papel não é rebaixamento e continua passando', async () => {
    const dono = await createUser('dono5@brabo.dev');
    const mant = await createUser('mant5@brabo.dev');
    const workspace = await createWorkspace(dono.id, 'umbrella');
    const project = await createProject(workspace.id, dono.id, 'core');
    await db.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: mant.id,
      role: 'maintainer',
    });

    await addProjectMember.execute(project.id, mant.id, mant.id, 'owner');

    expect(await resolveEffectiveRole.forProject(mant.id, project.id)).toBe(
      'owner',
    );
  });
});

describe('O que os tetos NÃO levam junto', () => {
  it('capacidade legítima: rebaixar OUTRA pessoa num projeto sensível continua possível', async () => {
    const dono = await createUser('dono6@brabo.dev');
    const dev = await createUser('dev6@brabo.dev');
    const workspace = await createWorkspace(dono.id, 'wayne');
    const project = await createProject(workspace.id, dono.id, 'core');
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: workspace.id, userId: dev.id, role: 'developer' });

    await addProjectMember.execute(project.id, dono.id, dev.id, 'viewer');

    expect(await resolveEffectiveRole.forProject(dev.id, project.id)).toBe(
      'viewer',
    );
  });

  it('capacidade legítima no outro sentido: viewer de workspace vira maintainer no projeto', async () => {
    const dono = await createUser('dono7@brabo.dev');
    const dev = await createUser('dev7@brabo.dev');
    const workspace = await createWorkspace(dono.id, 'stark');
    const project = await createProject(workspace.id, dono.id, 'core');
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: workspace.id, userId: dev.id, role: 'viewer' });

    await addProjectMember.execute(project.id, dono.id, dev.id, 'maintainer');

    expect(await resolveEffectiveRole.forProject(dev.id, project.id)).toBe(
      'maintainer',
    );
  });

  /**
   * A remoção NÃO ganhou teto — é o terceiro movimento, fora dos dois que o
   * ADR 0127 escolheu, e o ADR declara que segue possível. Estes dois casos
   * fixam o que a decisão deixou de pé, para a próxima pessoa não achar que
   * foi esquecimento: remover é benigno quando o papel de workspace segura a
   * queda, e é auto-rebaixamento NÃO coberto quando não segura.
   */
  it('auto-remoção continua permitida: o maintainer sai da lista e cai no papel de workspace', async () => {
    const dono = await createUser('dono8@brabo.dev');
    const mant = await createUser('mant8@brabo.dev');
    const workspace = await createWorkspace(dono.id, 'cyberdyne');
    const project = await createProject(workspace.id, dono.id, 'core');
    await db.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: mant.id,
      role: 'maintainer',
    });
    await db
      .insert(projectMembers)
      .values({ projectId: project.id, userId: mant.id, role: 'owner' });

    await removeProjectMember.execute(project.id, mant.id);

    expect(await resolveEffectiveRole.forProject(mant.id, project.id)).toBe(
      'maintainer',
    );
  });

  it('e a remoção SEGUE podendo rebaixar quem a chamou, quando o workspace não segura — lacuna declarada no ADR 0127', async () => {
    const dono = await createUser('dono9@brabo.dev');
    const mant = await createUser('mant9@brabo.dev');
    const workspace = await createWorkspace(dono.id, 'tyrell');
    const project = await createProject(workspace.id, dono.id, 'core');
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: workspace.id, userId: mant.id, role: 'viewer' });
    await db.insert(projectMembers).values({
      projectId: project.id,
      userId: mant.id,
      role: 'maintainer',
    });

    await removeProjectMember.execute(project.id, mant.id);

    expect(await resolveEffectiveRole.forProject(mant.id, project.id)).toBe(
      'viewer',
    );
  });
});
