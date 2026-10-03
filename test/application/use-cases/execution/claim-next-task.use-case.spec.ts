import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  epics,
  projects,
  sessions,
  stories,
  tasks,
  users,
  workspaces,
} from '../../../../src/db/schema';
import {
  DrizzleStoryRepository,
  DrizzleTaskRepository,
} from '../../../../src/infrastructure/persistence/drizzle/backlog.repository';
import { ClaimNextTaskUseCase } from '../../../../src/application/use-cases/execution/claim-next-task.use-case';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';

const { db, pool } = createTestDb();
const taskRepo = new DrizzleTaskRepository(db);
const appendStub = {
  execute: () => Promise.resolve({}),
} as unknown as AppendSessionEventUseCase;
const useCase = new ClaimNextTaskUseCase(taskRepo, appendStub);

async function seed(opts: {
  storyStatus: 'draft' | 'ready';
  moduleIds: string[];
  taskCount: number;
  taskModule?: string | null;
  archived?: boolean;
}) {
  const [owner] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-claim', email: 'claim@brabo.dev' })
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
      status: opts.storyStatus,
      moduleIds: opts.moduleIds,
      archivedAt: opts.archived ? new Date() : null,
    })
    .returning();
  for (let i = 0; i < opts.taskCount; i++) {
    await db.insert(tasks).values({
      storyId: story.id,
      title: `task-${i}`,
      module: opts.taskModule ?? null,
    });
  }
  return { projectId: project.id, sessionId: session.id, storyId: story.id };
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('ClaimNextTaskUseCase', () => {
  it('claims sucessivos pegam tasks DISTINTAS e esgotam (null)', async () => {
    const { projectId, sessionId } = await seed({
      storyStatus: 'ready',
      moduleIds: ['api'],
      taskCount: 2,
    });

    const t1 = await useCase.execute(projectId, sessionId, 'api', 'dev-api');
    const t2 = await useCase.execute(projectId, sessionId, 'api', 'dev-api-2');
    const t3 = await useCase.execute(projectId, sessionId, 'api', 'dev-api');

    expect(t1).not.toBeNull();
    expect(t2).not.toBeNull();
    expect(t1!.id).not.toBe(t2!.id); // nunca a mesma task
    expect(t1!.status).toBe('in_progress');
    expect(t1!.assignedTo).toBe('dev-api');
    expect(t2!.assignedTo).toBe('dev-api-2');
    expect(t3).toBeNull(); // esgotado
  });

  it('não pega task de story que não está ready', async () => {
    const { projectId, sessionId } = await seed({
      storyStatus: 'draft',
      moduleIds: ['api'],
      taskCount: 1,
    });
    expect(
      await useCase.execute(projectId, sessionId, 'api', 'dev-api'),
    ).toBeNull();
  });

  // RN-727: história arquivada sai do claim, da contagem, do plano e do
  // backlog — e as tarefas dela junto.
  it('não pega task de story ARQUIVADA, nem a conta, nem a lista', async () => {
    const { projectId, sessionId, storyId } = await seed({
      storyStatus: 'ready',
      moduleIds: ['api'],
      taskCount: 1,
      archived: true,
    });
    expect(
      await useCase.execute(projectId, sessionId, 'api', 'dev-api'),
    ).toBeNull();
    expect(await taskRepo.countClaimableByModule(projectId, 'api')).toBe(0);
    const [task] = await taskRepo.findByStoryIds([storyId]);
    expect(await taskRepo.findInProjectByIds(projectId, [task.id])).toEqual([]);
    const storyRepo = new DrizzleStoryRepository(db);
    expect(await storyRepo.findByProject(projectId)).toEqual([]);
    // A linha continua lá: arquivar não apaga.
    expect((await storyRepo.findById(storyId))?.archivedAt).toBeInstanceOf(
      Date,
    );
  });

  it('não pega task de módulo diferente', async () => {
    const { projectId, sessionId } = await seed({
      storyStatus: 'ready',
      moduleIds: ['web'],
      taskCount: 1,
    });
    expect(
      await useCase.execute(projectId, sessionId, 'api', 'dev-api'),
    ).toBeNull();
  });

  // AT-274 (RN-678): o módulo é o da TAREFA, atribuído pelo Dev Lead no plano.
  it('story com DOIS módulos: só o dev do módulo da TAREFA a pega', async () => {
    const { projectId, sessionId } = await seed({
      storyStatus: 'ready',
      moduleIds: ['board-engine', 'input-keyboard'],
      taskCount: 1,
      taskModule: 'board-engine',
    });
    expect(
      await useCase.execute(
        projectId,
        sessionId,
        'input-keyboard',
        'dev-input-keyboard',
      ),
    ).toBeNull();
    const pega = await useCase.execute(
      projectId,
      sessionId,
      'board-engine',
      'dev-board-engine',
    );
    expect(pega?.module).toBe('board-engine');
    expect(pega?.assignedTo).toBe('dev-board-engine');
  });

  it('tarefa SEM módulo de story com vários módulos não é pegável por nenhum (espera o plano)', async () => {
    const { projectId, sessionId } = await seed({
      storyStatus: 'ready',
      moduleIds: ['board-engine', 'input-keyboard'],
      taskCount: 1,
    });
    expect(
      await useCase.execute(projectId, sessionId, 'board-engine', 'dev-a'),
    ).toBeNull();
    expect(
      await useCase.execute(projectId, sessionId, 'input-keyboard', 'dev-b'),
    ).toBeNull();
    expect(
      await taskRepo.countClaimableByModule(projectId, 'board-engine'),
    ).toBe(0);
  });

  it('o módulo da tarefa vence os module_ids da story', async () => {
    const { projectId, sessionId } = await seed({
      storyStatus: 'ready',
      moduleIds: ['api'],
      taskCount: 1,
      taskModule: 'web',
    });
    expect(
      await useCase.execute(projectId, sessionId, 'api', 'dev-api'),
    ).toBeNull();
    expect(await taskRepo.countClaimableByModule(projectId, 'web')).toBe(1);
    expect(
      await useCase.execute(projectId, sessionId, 'web', 'dev-web'),
    ).not.toBeNull();
  });

  it('concorrência real: N claims simultâneos nunca pegam a mesma task', async () => {
    const taskCount = 8;
    const { projectId, sessionId } = await seed({
      storyStatus: 'ready',
      moduleIds: ['api'],
      taskCount,
    });

    const results = await Promise.all(
      Array.from({ length: taskCount }, (_, i) =>
        useCase.execute(projectId, sessionId, 'api', `dev-${i}`),
      ),
    );

    const claimed = results.filter((t) => t !== null);
    expect(claimed).toHaveLength(taskCount);
    const distinctIds = new Set(claimed.map((t) => t.id));
    expect(distinctIds.size).toBe(taskCount); // nenhuma task duplicada

    // Um claim a mais, sem tasks sobrando, esgota.
    expect(
      await useCase.execute(projectId, sessionId, 'api', 'dev-extra'),
    ).toBeNull();
  });
});
