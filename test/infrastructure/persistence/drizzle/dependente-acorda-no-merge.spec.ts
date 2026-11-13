import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  epics,
  moduleMaps,
  outboxEvents,
  projects,
  sessions,
  stories,
  tasks,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleTaskRepository } from '../../../../src/infrastructure/persistence/drizzle/backlog.repository';
import { DrizzleOutboxRepository } from '../../../../src/infrastructure/persistence/drizzle/outbox.repository';
import { DrizzleModuleMapRepository } from '../../../../src/infrastructure/persistence/drizzle/module-map.repository';
import { ExecuteGitActionUseCase } from '../../../../src/application/use-cases/actions/execute-git-action.use-case';
import type { ProposedAction } from '../../../../src/domain/actions/proposed-action.entity';

// RN-1009 (AT-746): o merge que fecha a última tarefa do persistence acorda o
// auth. Banco real; só git, engine e sessão são falsos.
const { db, pool } = createTestDb();
const taskRepo = new DrizzleTaskRepository(db);
const outbox = new DrizzleOutboxRepository(db);
const moduleMapRepo = new DrizzleModuleMapRepository(db);

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

function acao(
  actionType: ProposedAction['actionType'],
  projectId: string,
  sessionId: string,
  payload: Record<string, unknown>,
  executionResult: ProposedAction['executionResult'] = null,
): ProposedAction {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    projectId,
    sessionId,
    seq: 1,
    actionType,
    payload,
    status: 'approved',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'agent', id: 'dev-persistence' },
    decidedBy: null,
    decidedAt: new Date(),
    rejectionReason: null,
    executionResult,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function seed() {
  const [owner] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-wk', email: 'wk@brabo.dev' })
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
      { name: 'persistence', stack: 'pg', responsibility: 'x', dependsOn: [] },
      {
        name: 'auth',
        stack: 'nest',
        responsibility: 'x',
        dependsOn: ['persistence'],
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
      moduleIds: ['persistence', 'auth'],
    })
    .returning();
  const nova = async (module: string, status: 'todo' | 'in_review') =>
    (
      await db
        .insert(tasks)
        .values({ storyId: story.id, title: `t-${module}`, module, status })
        .returning()
    )[0];
  return { projectId: project.id, sessionId: session.id, nova };
}

function useCase(prOpen: ProposedAction) {
  const proposed = {
    listByProjectAndType: () => Promise.resolve([prOpen]),
    updateExecutionResult: () => Promise.resolve(prOpen),
  };
  return new ExecuteGitActionUseCase(
    { runInTransaction: (fn: () => Promise<unknown>) => fn() } as never,
    proposed as never,
    { execute: () => Promise.resolve({}) } as never,
    outbox,
    {} as never,
    {
      get: () => ({
        mergePullRequest: () =>
          Promise.resolve({ id: 'pr-6', state: 'merged', targetBranch: 'dev' }),
      }),
    } as never,
    {
      findByProjectId: () =>
        Promise.resolve({
          provider: 'local',
          externalId: '/tmp/repo',
          defaultBranch: 'main',
        }),
    } as never,
    {} as never,
    {} as never,
    { execute: () => Promise.resolve('owner') } as never,
    taskRepo,
    moduleMapRepo,
    { restaurar: () => Promise.resolve() } as never,
  );
}

describe('o merge da dependência acorda o dependente (RN-1009)', () => {
  it('grava task.became_claimable e o auth passa a pegar a tarefa', async () => {
    const { projectId, sessionId, nova } = await seed();
    const base = await nova('persistence', 'in_review');
    const auth = await nova('auth', 'todo');
    expect(await taskRepo.claimNext(projectId, 'auth', 'dev-auth')).toBeNull();

    const prOpen = acao(
      'pr_open',
      projectId,
      sessionId,
      { storyTaskId: base.id },
      {
        kind: 'pr_open',
        pullRequestUrl: 'local://x',
        pullRequestId: 'pr-6',
        sourceBranch: 'feature/x',
        targetBranch: 'dev',
      },
    );
    const uc = useCase(prOpen);
    const merge = () =>
      uc.execute(
        projectId,
        sessionId,
        acao('git_merge', projectId, sessionId, { pullRequestId: 'pr-6' }),
      );
    await merge();
    await merge(); // repetido: não duplica

    const linhas = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, 'task.became_claimable'));
    expect(linhas).toHaveLength(1);
    expect(linhas[0].aggregateType).toBe('task');
    expect(linhas[0].aggregateId).toBe(base.id);
    expect(linhas[0].payload).toEqual({
      projectId,
      sessionId,
      taskId: base.id,
      modules: ['auth'],
      cause: 'dependency_done',
    });
    const got = await taskRepo.claimNext(projectId, 'auth', 'dev-auth');
    expect(got?.id).toBe(auth.id);
  });
});
