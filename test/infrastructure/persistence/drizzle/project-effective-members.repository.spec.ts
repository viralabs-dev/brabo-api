import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  projectMembers,
  projects,
  users,
  workspaceMembers,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';

/**
 * `listEffectiveMembers` (RN-680) — quem a Anamnese considera membro do
 * projeto, pela régua da RN-471. Provada contra o Postgres porque o caso do
 * uso real de 29/09 é de SQL: criar projeto não grava `project_members`, e a
 * leitura só por ela não achava o dono do workspace.
 */
const { db, pool } = createTestDb();
const repo = new DrizzleProjectRepository(db);

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

async function cenario() {
  const [dono] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-dono', email: 'dono@brabo.dev' })
    .returning();
  const [restrito] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-restrito', email: 'restrito@brabo.dev' })
    .returning();
  const [deOutroWorkspace] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-outro', email: 'outro@brabo.dev' })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: dono.id })
    .returning();
  const [outro] = await db
    .insert(workspaces)
    .values({ name: 'outro', slug: 'outro', createdBy: deOutroWorkspace.id })
    .returning();
  await db.insert(workspaceMembers).values([
    { workspaceId: workspace.id, userId: dono.id, role: 'owner' },
    { workspaceId: workspace.id, userId: restrito.id, role: 'maintainer' },
    { workspaceId: outro.id, userId: deOutroWorkspace.id, role: 'owner' },
  ]);
  const [projeto] = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: 'p',
      slug: 'p',
      workspaceDirName: 'p-dir',
      createdBy: dono.id,
    })
    .returning();
  return { dono, restrito, projeto };
}

describe('DrizzleProjectRepository.listEffectiveMembers (RN-680)', () => {
  it('caminho feliz: o dono do workspace SEM linha de projeto é membro, com o papel do workspace', async () => {
    const { dono, projeto } = await cenario();

    const membros = await repo.listEffectiveMembers(projeto.id);

    expect(membros).toContainEqual(
      expect.objectContaining({ userId: dono.id, role: 'owner' }),
    );
    // A leitura de sempre continua só com as linhas de projeto.
    expect(await repo.listMembers(projeto.id)).toEqual([]);
  });

  it('a linha de projeto sobrepõe a de workspace, e quem é de OUTRO workspace não entra', async () => {
    const { restrito, projeto } = await cenario();
    await db
      .insert(projectMembers)
      .values({ projectId: projeto.id, userId: restrito.id, role: 'viewer' });

    const membros = await repo.listEffectiveMembers(projeto.id);

    expect(membros.filter((m) => m.userId === restrito.id)).toEqual([
      expect.objectContaining({ role: 'viewer' }),
    ]);
    expect(membros).toHaveLength(2);
  });
});
