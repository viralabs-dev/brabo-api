import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  projectMembers,
  projects,
  users,
  workspaceMembers,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleWorkspaceRepository } from '../../../../src/infrastructure/persistence/drizzle/workspace.repository';
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';
import { ResolveEffectiveRoleUseCase } from '../../../../src/application/use-cases/iam/resolve-effective-role.use-case';

const { db, pool } = createTestDb();
const projectRepo = new DrizzleProjectRepository(db);
const workspaceRepo = new DrizzleWorkspaceRepository(db);
const resolveEffectiveRole = new ResolveEffectiveRoleUseCase(
  projectRepo,
  workspaceRepo,
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
  return row;
}

async function createProject(
  workspaceId: string,
  ownerId: string,
  slug: string,
) {
  const [row] = await db
    .insert(projects)
    .values({ workspaceId, name: slug, slug, createdBy: ownerId })
    .returning();
  return row;
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('ResolveEffectiveRoleUseCase.forProject', () => {
  it('caminho feliz: papel de projeto sobrepõe o de workspace', async () => {
    const owner = await createUser('owner@brabo.dev');
    const dev = await createUser('dev@brabo.dev');
    const workspace = await createWorkspace(owner.id, 'acme');
    const project = await createProject(workspace.id, owner.id, 'core');

    // dev é "viewer" no workspace, mas "maintainer" só neste projeto.
    await db.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: dev.id,
      role: 'viewer',
    });
    await db.insert(projectMembers).values({
      projectId: project.id,
      userId: dev.id,
      role: 'maintainer',
    });

    const effective = await resolveEffectiveRole.forProject(dev.id, project.id);
    expect(effective).toBe('maintainer');
  });

  it('sem papel de projeto, cai para o papel de workspace', async () => {
    const owner = await createUser('owner2@brabo.dev');
    const member = await createUser('member2@brabo.dev');
    const workspace = await createWorkspace(owner.id, 'globex');
    const project = await createProject(workspace.id, owner.id, 'core');

    await db.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: member.id,
      role: 'developer',
    });

    const effective = await resolveEffectiveRole.forProject(
      member.id,
      project.id,
    );
    expect(effective).toBe('developer');
  });

  it('RBAC nega acesso entre projetos: sem membership em nenhum nível, retorna null', async () => {
    const owner = await createUser('owner3@brabo.dev');
    const outsider = await createUser('outsider@brabo.dev');

    const workspaceA = await createWorkspace(owner.id, 'workspace-a');
    const projectA = await createProject(workspaceA.id, owner.id, 'project-a');
    await db.insert(projectMembers).values({
      projectId: projectA.id,
      userId: outsider.id,
      role: 'owner',
    });

    // outsider tem papel só no projeto A / workspace A — workspace B é
    // completamente alheio a ele.
    const workspaceB = await createWorkspace(owner.id, 'workspace-b');
    const projectB = await createProject(workspaceB.id, owner.id, 'project-b');

    const effectiveOnA = await resolveEffectiveRole.forProject(
      outsider.id,
      projectA.id,
    );
    const effectiveOnB = await resolveEffectiveRole.forProject(
      outsider.id,
      projectB.id,
    );

    expect(effectiveOnA).toBe('owner');
    expect(effectiveOnB).toBeNull();
  });

  it('projeto inexistente retorna null', async () => {
    const user = await createUser('ghost@brabo.dev');
    const effective = await resolveEffectiveRole.forProject(
      user.id,
      '00000000-0000-0000-0000-000000000000',
    );
    expect(effective).toBeNull();
  });
});
