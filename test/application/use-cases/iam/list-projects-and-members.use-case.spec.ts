import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  projectMembers,
  projects,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';
import { ListProjectsForWorkspaceUseCase } from '../../../../src/application/use-cases/iam/list-projects-for-workspace.use-case';
import { ListProjectMembersUseCase } from '../../../../src/application/use-cases/iam/list-project-members.use-case';
import { RemoveProjectMemberUseCase } from '../../../../src/application/use-cases/iam/remove-project-member.use-case';

const { db, pool } = createTestDb();
const projectRepo = new DrizzleProjectRepository(db);
const listProjectsForWorkspace = new ListProjectsForWorkspaceUseCase(
  projectRepo,
);
const listProjectMembers = new ListProjectMembersUseCase(projectRepo);
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

describe('ListProjectsForWorkspaceUseCase', () => {
  it('caminho feliz: lista só os projetos do workspace informado', async () => {
    const owner = await createUser('owner@brabo.dev');
    const workspaceA = await createWorkspace(owner.id, 'workspace-a');
    const workspaceB = await createWorkspace(owner.id, 'workspace-b');
    await createProject(workspaceA.id, owner.id, 'core');
    await createProject(workspaceA.id, owner.id, 'web');
    await createProject(workspaceB.id, owner.id, 'outro');

    const result = await listProjectsForWorkspace.execute(workspaceA.id);

    expect(result).toHaveLength(2);
    expect(result.map((p) => p.slug).sort()).toEqual(['core', 'web']);
  });

  it('workspace sem projetos retorna lista vazia', async () => {
    const owner = await createUser('owner2@brabo.dev');
    const workspace = await createWorkspace(owner.id, 'vazio');

    const result = await listProjectsForWorkspace.execute(workspace.id);

    expect(result).toEqual([]);
  });
});

describe('ListProjectMembersUseCase', () => {
  it('caminho feliz: lista membros com nome/email/papel', async () => {
    const owner = await createUser('owner3@brabo.dev');
    const dev = await createUser('dev3@brabo.dev');
    const workspace = await createWorkspace(owner.id, 'acme');
    const project = await createProject(workspace.id, owner.id, 'core');
    await db
      .insert(projectMembers)
      .values({ projectId: project.id, userId: dev.id, role: 'developer' });

    const result = await listProjectMembers.execute(project.id);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      userId: dev.id,
      role: 'developer',
      email: 'dev3@brabo.dev',
    });
  });

  it('404 pra projeto inexistente', async () => {
    await expect(
      listProjectMembers.execute('00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('RemoveProjectMemberUseCase', () => {
  it('caminho feliz: remove o membro da lista', async () => {
    const owner = await createUser('owner4@brabo.dev');
    const dev = await createUser('dev4@brabo.dev');
    const workspace = await createWorkspace(owner.id, 'acme4');
    const project = await createProject(workspace.id, owner.id, 'core4');
    await db
      .insert(projectMembers)
      .values({ projectId: project.id, userId: dev.id, role: 'developer' });

    await removeProjectMember.execute(project.id, dev.id);

    const remaining = await listProjectMembers.execute(project.id);
    expect(remaining).toEqual([]);
  });

  it('404 pra projeto inexistente', async () => {
    await expect(
      removeProjectMember.execute(
        '00000000-0000-0000-0000-000000000000',
        '00000000-0000-0000-0000-000000000000',
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
