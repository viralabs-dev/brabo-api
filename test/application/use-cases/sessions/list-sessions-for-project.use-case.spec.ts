import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  projects,
  sessions,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleSessionRepository } from '../../../../src/infrastructure/persistence/drizzle/session.repository';
import { DrizzleRepoBootstrapRepository } from '../../../../src/infrastructure/persistence/drizzle/repo-bootstrap.repository';
import { ListSessionsForProjectUseCase } from '../../../../src/application/use-cases/sessions/list-sessions-for-project.use-case';

const { db, pool } = createTestDb();
const sessionRepo = new DrizzleSessionRepository(db);
const repoBootstrapRepo = new DrizzleRepoBootstrapRepository(db);
const listSessionsForProject = new ListSessionsForProjectUseCase(
  sessionRepo,
  repoBootstrapRepo,
);

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

  it('RN-592: marca como técnica só a sessão vinculada em repo_bootstraps, pelo vínculo e não pelo nome', async () => {
    const { user, project, otherProject } = await setupProject();
    // A técnica RENOMEADA: o nome deixa de ser `git-bootstrap` e o marcador
    // continua — era o nome que a tela lia antes (AT-183).
    const [tecnica] = await db
      .insert(sessions)
      .values({ projectId: project.id, createdBy: user.id, name: 'renomeada' })
      .returning();
    // Uma de trabalho com o nome antigo NÃO vira técnica por causa do nome.
    const [trabalho] = await db
      .insert(sessions)
      .values({
        projectId: project.id,
        createdBy: user.id,
        name: 'git-bootstrap',
      })
      .returning();
    await repoBootstrapRepo.create({
      projectId: project.id,
      sessionId: tecnica.id,
    });
    // A técnica de OUTRO projeto não marca nada aqui.
    const [alheia] = await db
      .insert(sessions)
      .values({ projectId: otherProject.id, createdBy: user.id })
      .returning();
    await repoBootstrapRepo.create({
      projectId: otherProject.id,
      sessionId: alheia.id,
    });

    const result = await listSessionsForProject.execute(project.id);

    const porId = new Map(result.map((s) => [s.id, s.technical]));
    expect(porId.get(tecnica.id)).toBe(true);
    expect(porId.get(trabalho.id)).toBe(false);
    expect(porId.has(alheia.id)).toBe(false);
  });

  it('sem repo_bootstraps, nenhuma sessão é técnica', async () => {
    const { user, project } = await setupProject();
    await db
      .insert(sessions)
      .values({ projectId: project.id, createdBy: user.id });

    const result = await listSessionsForProject.execute(project.id);

    expect(result.map((s) => s.technical)).toEqual([false]);
  });

  it('retorna lista vazia para projeto sem sessões', async () => {
    const { project } = await setupProject();
    const result = await listSessionsForProject.execute(project.id);
    expect(result).toEqual([]);
  });
});
