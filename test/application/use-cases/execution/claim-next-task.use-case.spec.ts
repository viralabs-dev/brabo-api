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
import { DrizzleTaskRepository } from '../../../../src/infrastructure/persistence/drizzle/backlog.repository';
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
    .values({ workspaceId: ws.id, name: 'core', slug: 'core', createdBy: owner.id })
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
    })
    .returning();
  for (let i = 0; i < opts.taskCount; i++) {
    await db
      .insert(tasks)
      .values({ storyId: story.id, title: `task-${i}` });
  }
  return { projectId: project.id, sessionId: session.id };
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
    expect(await useCase.execute(projectId, sessionId, 'api', 'dev-api')).toBeNull();
  });

  it('não pega task de módulo diferente', async () => {
    const { projectId, sessionId } = await seed({
      storyStatus: 'ready',
      moduleIds: ['web'],
      taskCount: 1,
    });
    expect(await useCase.execute(projectId, sessionId, 'api', 'dev-api')).toBeNull();
  });
});
