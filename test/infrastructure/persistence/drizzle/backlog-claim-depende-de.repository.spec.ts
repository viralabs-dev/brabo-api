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

// AT-990 (RN-1372): `depende_de` por tarefa libera o claim; sem ele, vale a
// régua do módulo (RN-1005). Claim e contagem concordam (RN-678).
const { db, pool } = createTestDb();
const repo = new DrizzleTaskRepository(db);

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

async function seed() {
  const [owner] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-dd', email: 'dd@brabo.dev' })
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
      { name: 'cadastro', stack: 'nest', responsibility: 'x', dependsOn: [] },
      {
        name: 'agenda',
        stack: 'nest',
        responsibility: 'x',
        dependsOn: ['cadastro'],
      },
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
      moduleIds: ['cadastro', 'agenda'],
    })
    .returning();
  const nova = async (
    module: string,
    status: 'todo' | 'done' = 'todo',
    dependeDe: string[] = [],
  ) =>
    (
      await db
        .insert(tasks)
        .values({
          storyId: story.id,
          title: `t-${module}-${dependeDe.length}`,
          module,
          status,
          dependeDe,
        })
        .returning()
    )[0];
  return { projectId: project.id, nova };
}

describe('claim por tarefa (RN-1372)', () => {
  it('com depende_de=[T1], sai quando T1 está done, mesmo com T2 do cadastro em todo', async () => {
    const { projectId, nova } = await seed();
    await nova('cadastro', 'done'); // T1
    const t1 = (await db.select().from(tasks))[0];
    await nova('cadastro'); // T2 aberta
    const a = await nova('agenda', 'todo', [t1.id]);
    expect(await repo.countClaimableByModule(projectId, 'agenda')).toBe(1);
    const got = await repo.claimNext(projectId, 'agenda', 'dev-agenda');
    expect(got?.id).toBe(a.id);
    expect(got?.dependeDe).toEqual([t1.id]);
  });

  it('com depende_de=[T1] aberta, espera T1', async () => {
    const { projectId, nova } = await seed();
    const t1 = await nova('cadastro');
    await nova('agenda', 'todo', [t1.id]);
    expect(await repo.countClaimableByModule(projectId, 'agenda')).toBe(0);
    expect(await repo.claimNext(projectId, 'agenda', 'dev-agenda')).toBeNull();
  });

  it('sem depende_de, espera o módulo inteiro (fallback RN-1005)', async () => {
    const { projectId, nova } = await seed();
    await nova('cadastro', 'done');
    await nova('cadastro'); // T2 aberta
    await nova('agenda');
    expect(await repo.countClaimableByModule(projectId, 'agenda')).toBe(0);
    expect(await repo.claimNext(projectId, 'agenda', 'dev-agenda')).toBeNull();
  });

  it('modulosDosDependentes devolve o módulo da tarefa aberta que depende da fechada', async () => {
    const { projectId, nova } = await seed();
    const t1 = await nova('cadastro', 'done');
    await nova('agenda', 'todo', [t1.id]);
    await nova('agenda'); // sem depende_de: fora
    expect(await repo.modulosDosDependentes(projectId, [t1.id])).toEqual([
      'agenda',
    ]);
    expect(await repo.modulosDosDependentes(projectId, [])).toEqual([]);
  });

  it('assignModules grava depende_de e setLevantamento grava o levantamento', async () => {
    const { nova } = await seed();
    const t1 = await nova('cadastro');
    const a = await nova('agenda');
    await repo.assignModules([
      { taskId: a.id, module: 'agenda', dependeDe: [t1.id] },
    ]);
    const lev = {
      arquivos: ['a.ts'],
      expoe: ['X'],
      consome: [],
      dependenciasNpm: [],
      aceite: 'ok',
    };
    await repo.setLevantamento(a.id, lev);
    const lida = await repo.findById(a.id);
    expect(lida?.dependeDe).toEqual([t1.id]);
    expect(lida?.levantamento).toEqual(lev);
    // assignModules sem dependeDe não apaga o que já está gravado.
    await repo.assignModules([{ taskId: a.id, module: 'agenda' }]);
    expect((await repo.findById(a.id))?.dependeDe).toEqual([t1.id]);
  });
});
