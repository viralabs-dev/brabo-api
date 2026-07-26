import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  projects,
  sessions,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleSessionRepository } from '../../../../src/infrastructure/persistence/drizzle/session.repository';
import { ListSessionsForProjectUseCase } from '../../../../src/application/use-cases/sessions/list-sessions-for-project.use-case';

const { db, pool } = createTestDb();
const sessionRepo = new DrizzleSessionRepository(db);
const listSessionsForProject = new ListSessionsForProjectUseCase(sessionRepo);

async function setupProject() {
  const [user] = await db
    .insert(users)
    .values({
      keycloakSub: 'sub-list-sessions',
      email: 'list-sessions@brabo.dev',
    })
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
  const [otherProject] = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: 'other',
      slug: 'other',
      createdBy: user.id,
    })
    .returning();
  return { user, project, otherProject };
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('ListSessionsForProjectUseCase', () => {
  it('caminho feliz: lista só as sessões do projeto informado', async () => {
    const { user, project, otherProject } = await setupProject();
    await db
      .insert(sessions)
      .values({ projectId: project.id, createdBy: user.id });
    await db
      .insert(sessions)
      .values({ projectId: project.id, createdBy: user.id });
    await db
      .insert(sessions)
      .values({ projectId: otherProject.id, createdBy: user.id });

    const result = await listSessionsForProject.execute(project.id);

    expect(result).toHaveLength(2);
    expect(result.every((s) => s.projectId === project.id)).toBe(true);
  });

  it('retorna lista vazia para projeto sem sessões', async () => {
    const { project } = await setupProject();
    const result = await listSessionsForProject.execute(project.id);
    expect(result).toEqual([]);
  });
});
