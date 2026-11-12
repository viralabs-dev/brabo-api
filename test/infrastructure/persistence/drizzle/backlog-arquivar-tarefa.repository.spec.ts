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

// AT-912/AT-913: arquivar tarefa, o predicado único do claim e da contagem, e
// os módulos entregues.
const { db, pool } = createTestDb();
const repo = new DrizzleTaskRepository(db);

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

async function seed(moduleIds: string[] = ['db', 'api']) {
  const [owner] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-arq', email: 'arq@brabo.dev' })
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
  await db.insert(moduleMaps).values({
    projectId: project.id,
    sessionId: session.id,
    modules: [
      { name: 'db', stack: 'pg', responsibility: 'x', dependsOn: [] },
      { name: 'api', stack: 'nest', responsibility: 'x', dependsOn: ['db'] },
    ],
  });
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
      moduleIds,
    })
    .returning();
  const nova = async (
    module: string | null,
    status: 'todo' | 'in_progress' | 'done' = 'todo',
    fundacao = false,
  ) =>
    (
      await db
        .insert(tasks)
        .values({
          storyId: story.id,
          title: `t-${module}`,
          module,
          status,
          fundacao,
        })
        .returning()
    )[0];
  return { projectId: project.id, nova };
}

describe('archive (AT-912)', () => {
  it('arquiva só `todo`, uma vez; in_progress devolve null', async () => {
    const { nova } = await seed();
    const t = await nova('db');
    const ativa = await nova('db', 'in_progress');
    expect((await repo.archive(t.id, 'duplicada'))?.archivedReason).toBe(
      'duplicada',
    );
    expect(await repo.archive(t.id, 'de novo')).toBeNull();
    expect(await repo.archive(ativa.id, 'x')).toBeNull();
  });

  it('a arquivada sai do claim e da contagem', async () => {
    const { projectId, nova } = await seed();
    const t = await nova('db');
    expect(await repo.countClaimableByModule(projectId, 'db')).toBe(1);
    await repo.archive(t.id, 'x');
    expect(await repo.countClaimableByModule(projectId, 'db')).toBe(0);
    expect(await repo.claimNext(projectId, 'db', 'dev-db')).toBeNull();
  });

  it('a arquivada não segura o dependente (e a aberta segura)', async () => {
    const { projectId, nova } = await seed();
    const db1 = await nova('db');
    const api = await nova('api');
    expect(await repo.claimNext(projectId, 'api', 'dev-api')).toBeNull();
    await repo.archive(db1.id, 'x');
    expect((await repo.claimNext(projectId, 'api', 'dev-api'))?.id).toBe(
      api.id,
    );
  });
});

describe('countClaimableByModule usa o predicado do claim (AT-906)', () => {
  it('tarefa com dependência aberta não conta', async () => {
    const { projectId, nova } = await seed();
    await nova('db');
    await nova('api');
    expect(await repo.countClaimableByModule(projectId, 'api')).toBe(0);
    expect(await repo.countClaimableByModule(projectId, 'db')).toBe(1);
  });
});

describe('modulosEntregues (AT-913)', () => {
  it('módulo com tarefas e todas done; aberta, arquivada e sem tarefa não entregam', async () => {
    const { projectId, nova } = await seed(['db', 'api', 'web']);
    await nova('db', 'done');
    await nova('api', 'done');
    await nova('api');
    const arq = await nova('web');
    await repo.archive(arq.id, 'x');
    expect(await repo.modulosEntregues(projectId)).toEqual(['db']);
  });

  it('tarefa sem módulo em história de UM módulo conta para ele', async () => {
    const { projectId, nova } = await seed(['db']);
    await nova(null, 'done');
    expect(await repo.modulosEntregues(projectId)).toEqual(['db']);
  });
});

describe('a fundação do módulo vem primeiro (AT-901, RN-1138)', () => {
  it('a funcionalidade criada ANTES espera a fundação, que sai primeiro', async () => {
    const { projectId, nova } = await seed();
    const func = await nova('db');
    const fund = await nova('db', 'todo', true);

    expect(await repo.countClaimableByModule(projectId, 'db')).toBe(1);
    expect((await repo.claimNext(projectId, 'db', 'dev-db'))?.id).toBe(fund.id);
    // fundação em curso: as outras seguem seguradas
    expect(await repo.claimNext(projectId, 'db', 'dev-db-2')).toBeNull();
    await repo.markDoneIfNotDone(fund.id);
    expect(await repo.countClaimableByModule(projectId, 'db')).toBe(1);
    expect((await repo.claimNext(projectId, 'db', 'dev-db'))?.id).toBe(func.id);
  });

  it('a fundação arquivada ou de outro módulo não segura', async () => {
    const { projectId, nova } = await seed();
    const func = await nova('db');
    const arq = await nova('db', 'todo', true);
    await repo.archive(arq.id, 'x');
    await nova('api', 'todo', true);

    expect((await repo.claimNext(projectId, 'db', 'dev-db'))?.id).toBe(func.id);
  });
});
