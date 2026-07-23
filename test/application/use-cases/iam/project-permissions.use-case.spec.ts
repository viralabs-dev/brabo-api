import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotFoundException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { projects, users, workspaces } from '../../../../src/db/schema';
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';
import { FsPermissionsFileStore } from '../../../../src/infrastructure/filesystem/fs-permissions-file-store';
import { GetProjectPermissionsUseCase } from '../../../../src/application/use-cases/iam/get-project-permissions.use-case';
import { SetProjectPermissionsUseCase } from '../../../../src/application/use-cases/iam/set-project-permissions.use-case';
import { EMPTY_PERMISSIONS_FILE } from '../../../../src/domain/actions/permissions-file';

const { db, pool } = createTestDb();
const projectRepo = new DrizzleProjectRepository(db);
const permissionsFileStore = new FsPermissionsFileStore();

const getProjectPermissions = new GetProjectPermissionsUseCase(
  projectRepo,
  permissionsFileStore,
);
const setProjectPermissions = new SetProjectPermissionsUseCase(
  projectRepo,
  permissionsFileStore,
);

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

let workspacesRoot: string;

beforeEach(async () => {
  await truncateAll(db);
  workspacesRoot = await mkdtemp(join(tmpdir(), 'brabo-workspaces-test-'));
  process.env.PROJECT_WORKSPACES_ROOT = workspacesRoot;
});

afterEach(async () => {
  if (workspacesRoot)
    await rm(workspacesRoot, { recursive: true, force: true });
});

afterAll(async () => {
  await pool.end();
});

describe('project permissions use-cases', () => {
  it('projeto recém-criado, sem permissions.json gravado, retorna o default vazio', async () => {
    const { project } = await setupProject();
    const permissions = await getProjectPermissions.execute(project.id);
    expect(permissions).toEqual(EMPTY_PERMISSIONS_FILE);
  });

  it('set seguido de get reflete a mudança (lida do arquivo físico)', async () => {
    const { project } = await setupProject();

    await setProjectPermissions.execute(project.id, {
      allow: ['Terminal(echo oi)'],
      deny: [],
      ask: [],
    });

    const permissions = await getProjectPermissions.execute(project.id);
    expect(permissions).toEqual({
      allow: ['Terminal(echo oi)'],
      deny: [],
      ask: [],
    });
  });

  it('404 em projeto inexistente', async () => {
    const missingId = '00000000-0000-0000-0000-000000000000';
    await expect(getProjectPermissions.execute(missingId)).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      setProjectPermissions.execute(missingId, EMPTY_PERMISSIONS_FILE),
    ).rejects.toThrow(NotFoundException);
  });
});
