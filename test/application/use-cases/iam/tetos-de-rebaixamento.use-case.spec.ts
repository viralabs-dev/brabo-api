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
const removeProjectMember = new RemoveProjectMemberUseCase(
  projectRepo,
  resolveEffectiveRole,
);

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
});

/**
 * A REMOÇÃO da própria linha (ADR 0156, RN-556) — o movimento que o ADR 0127
 * declarou fora dos dois tetos e FIXOU em teste como lacuna aberta, com a
 * frase "e a remoção SEGUE podendo rebaixar quem a chamou". Estes casos são
 * aquele bloco INVERTIDO: o que era prova de que o buraco existia passa a ser
 * prova de que ele fechou, e os movimentos benignos que o ADR 0127 protegia
 * continuam aqui para que fechar não vire teto demais.
 *
 * A régua é a do teto 2, com o papel de WORKSPACE no lugar do papel pedido —
 * é o papel que o ator terá depois de a linha sair.
 */
describe('Teto 2 pela outra porta — a remoção da própria linha', () => {
  it('recusa (403) a auto-remoção quando o workspace NÃO segura o papel — era a lacuna declarada no ADR 0127', async () => {
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

    await expect(
      removeProjectMember.execute(project.id, mant.id, mant.id),
    ).rejects.toThrow(ForbiddenException);

    // Nada foi removido: o efetivo continua vindo da linha de projeto.
    expect(await resolveEffectiveRole.forProject(mant.id, project.id)).toBe(
      'maintainer',
    );
  });

  it('recusa (403) também o rebaixamento REVERSÍVEL — o preço declarado do teto 2, que não tem limiar', async () => {
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

    await expect(
      removeProjectMember.execute(project.id, mant.id, mant.id),
    ).rejects.toThrow(ForbiddenException);

    expect(await resolveEffectiveRole.forProject(mant.id, project.id)).toBe(
      'owner',
    );
  });

  it('recusa (403) a auto-remoção de quem não tem papel NENHUM no workspace — o rebaixamento máximo', async () => {
    const dono = await createUser('dono10@brabo.dev');
    const mant = await createUser('mant10@brabo.dev');
    const workspace = await createWorkspace(dono.id, 'soylent');
    const project = await createProject(workspace.id, dono.id, 'core');
    await db.insert(projectMembers).values({
      projectId: project.id,
      userId: mant.id,
      role: 'maintainer',
    });

    await expect(
      removeProjectMember.execute(project.id, mant.id, mant.id),
    ).rejects.toThrow(ForbiddenException);

    expect(await resolveEffectiveRole.forProject(mant.id, project.id)).toBe(
      'maintainer',
    );
  });

  it('auto-remoção BENIGNA continua passando: o workspace segura o mesmo papel', async () => {
    const dono = await createUser('dono11@brabo.dev');
    const mant = await createUser('mant11@brabo.dev');
    const workspace = await createWorkspace(dono.id, 'weyland');
    const project = await createProject(workspace.id, dono.id, 'core');
    await db.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: mant.id,
      role: 'maintainer',
    });
    await db.insert(projectMembers).values({
      projectId: project.id,
      userId: mant.id,
      role: 'maintainer',
    });

    await removeProjectMember.execute(project.id, mant.id, mant.id);

    expect(await projectRepo.findMemberRole(project.id, mant.id)).toBeNull();
    expect(await resolveEffectiveRole.forProject(mant.id, project.id)).toBe(
      'maintainer',
    );
  });

  it('remover OUTRA pessoa continua passando, inclusive quando ela cai de papel', async () => {
    const dono = await createUser('dono12@brabo.dev');
    const dev = await createUser('dev12@brabo.dev');
    const workspace = await createWorkspace(dono.id, 'oscorp');
    const project = await createProject(workspace.id, dono.id, 'core');
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: workspace.id, userId: dev.id, role: 'viewer' });
    await db.insert(projectMembers).values({
      projectId: project.id,
      userId: dev.id,
      role: 'maintainer',
    });

    await removeProjectMember.execute(project.id, dono.id, dev.id);

    expect(await resolveEffectiveRole.forProject(dev.id, project.id)).toBe(
      'viewer',
    );
  });

  /**
   * O teto 1 NÃO tem par na remoção, e este caso é a decisão em forma de
   * teste: `owner` é o topo do `ROLE_ORDER`, então tirar a linha que
   * restringia o dono num projeto sensível só pode ELEVAR o efetivo dele —
   * é justamente como se desfaz a restrição. Um teto ali recusaria só
   * movimentos benignos.
   */
  it('remover a linha que restringia o owner do WORKSPACE devolve o projeto a ele', async () => {
    const dono = await createUser('dono13@brabo.dev');
    const mant = await createUser('mant13@brabo.dev');
    const workspace = await createWorkspace(dono.id, 'tessier');
    const project = await createProject(workspace.id, dono.id, 'core');
    await db.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: mant.id,
      role: 'maintainer',
    });
    await db
      .insert(projectMembers)
      .values({ projectId: project.id, userId: dono.id, role: 'viewer' });

    await removeProjectMember.execute(project.id, mant.id, dono.id);

    expect(await resolveEffectiveRole.forProject(dono.id, project.id)).toBe(
      'owner',
    );
  });
});
