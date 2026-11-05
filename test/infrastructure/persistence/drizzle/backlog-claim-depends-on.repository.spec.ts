import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  epics,
  moduleMaps,
  projects,
  sessions,
  stories,
  tasks,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleTaskRepository } from '../../../../src/infrastructure/persistence/drizzle/backlog.repository';

// RN-1005 (AT-742, ADR 0259): o claim respeita o `dependsOn` DIRETO.
const { db, pool } = createTestDb();
const repo = new DrizzleTaskRepository(db);

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

async function seed(comMapa = true) {
  const [owner] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-dep', email: 'dep@brabo.dev' })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: owner.id })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: ws.id,
      name: 'core',
      slug: 'core',
      createdBy: owner.id,
    })
    .returning();
  const [session] = await db
    .insert(sessions)
    .values({ projectId: project.id, createdBy: owner.id })
    .returning();
  if (comMapa) {
    await db.insert(moduleMaps).values({
      projectId: project.id,
      sessionId: session.id,
      modules: [
        { name: 'db', stack: 'pg', responsibility: 'x', dependsOn: [] },
        { name: 'api', stack: 'nest', responsibility: 'x', dependsOn: ['db'] },
        {
          name: 'deploy',
          stack: 'compose',
          responsibility: 'x',
          dependsOn: ['api'],
        },
      ],
    });
  }
  const [epic] = await db
    .insert(epics)
    .values({ projectId: project.id, sessionId: session.id, title: 'e' })
    .returning();
  const [story] = await db
    .insert(stories)
    .values({
      epicId: epic.id,
      projectId: project.id,
      sessionId: session.id,
      title: 's',
      status: 'ready',
      moduleIds: ['db', 'api', 'deploy'],
    })
    .returning();
  const nova = async (module: string, status: 'todo' | 'done' = 'todo') =>
    (
      await db
        .insert(tasks)
        .values({ storyId: story.id, title: `t-${module}`, module, status })
        .returning()
    )[0];
  return { projectId: project.id, nova };
}

describe('claimNext respeita o dependsOn direto (RN-1005)', () => {
  it('com tarefa aberta no módulo de que depende, não entrega', async () => {
    const { projectId, nova } = await seed();
    await nova('api');
    await nova('deploy');
    expect(await repo.claimNext(projectId, 'deploy', 'dev-deploy')).toBeNull();
  });

  it('com o módulo de que depende em done, entrega', async () => {
    const { projectId, nova } = await seed();
    await nova('api', 'done');
    const deploy = await nova('deploy');
    const got = await repo.claimNext(projectId, 'deploy', 'dev-deploy');
    expect(got?.id).toBe(deploy.id);
  });

  it('só o dependsOn DIRETO conta: deploy não espera db', async () => {
    const { projectId, nova } = await seed();
    await nova('db');
    await nova('api', 'done');
    const deploy = await nova('deploy');
    const got = await repo.claimNext(projectId, 'deploy', 'dev-deploy');
    expect(got?.id).toBe(deploy.id);
  });

  it('sem module_map o comportamento é o de sempre', async () => {
    const { projectId, nova } = await seed(false);
    await nova('api');
    const deploy = await nova('deploy');
    const got = await repo.claimNext(projectId, 'deploy', 'dev-deploy');
    expect(got?.id).toBe(deploy.id);
  });
});
