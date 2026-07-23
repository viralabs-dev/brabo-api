import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { projects, users, workspaces } from '../../../../src/db/schema';
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';
import { GetProjectPermissionsUseCase } from '../../../../src/application/use-cases/iam/get-project-permissions.use-case';
import { SetProjectPermissionsUseCase } from '../../../../src/application/use-cases/iam/set-project-permissions.use-case';

const { db, pool } = createTestDb();
const projectRepo = new DrizzleProjectRepository(db);

const getProjectPermissions = new GetProjectPermissionsUseCase(projectRepo);
const setProjectPermissions = new SetProjectPermissionsUseCase(projectRepo);

async function setupProject() {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-permissions', email: 'permissions@brabo.dev' })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: user.id })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: 'core',
      slug: 'core',
      createdBy: user.id,
    })
    .returning();
  return { user, workspace, project };
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('project permissions use-cases', () => {
  it('projeto recém-criado, sem permissions configurado, retorna {rules: []}', async () => {
    const { project } = await setupProject();
    const permissions = await getProjectPermissions.execute(project.id);
    expect(permissions).toEqual({ rules: [] });
  });

  it('set seguido de get reflete a mudança', async () => {
    const { project } = await setupProject();

    await setProjectPermissions.execute(project.id, {
      rules: [{ actionType: 'shell.*', policy: 'auto_approve' }],
    });

    const permissions = await getProjectPermissions.execute(project.id);
    expect(permissions).toEqual({
      rules: [{ actionType: 'shell.*', policy: 'auto_approve' }],
    });
  });

  it('404 em projeto inexistente', async () => {
    const missingId = '00000000-0000-0000-0000-000000000000';
    await expect(getProjectPermissions.execute(missingId)).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      setProjectPermissions.execute(missingId, { rules: [] }),
    ).rejects.toThrow(NotFoundException);
  });
});
