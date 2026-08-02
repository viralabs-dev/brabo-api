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
import { MarkTaskBlockedUseCase } from '../../../../src/application/use-cases/execution/mark-task-blocked.use-case';
import { UnblockTaskUseCase } from '../../../../src/application/use-cases/execution/unblock-task.use-case';
import { ClaimNextTaskUseCase } from '../../../../src/application/use-cases/execution/claim-next-task.use-case';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { OutboxRepository } from '../../../../src/application/ports/outbox-repository.port';

const { db, pool } = createTestDb();
const taskRepo = new DrizzleTaskRepository(db);
const storyRepo = new DrizzleStoryRepository(db);
const appendStub = {
  execute: () => Promise.resolve({}),
} as unknown as AppendSessionEventUseCase;
const outboxStub = {
  append: () => Promise.resolve(),
} as unknown as OutboxRepository;
const markBlocked = new MarkTaskBlockedUseCase(taskRepo, appendStub);
const unblock = new UnblockTaskUseCase(
  taskRepo,
  storyRepo,
  appendStub,
  outboxStub,
);
const claimNext = new ClaimNextTaskUseCase(taskRepo, appendStub);

async function seed() {
  const [owner] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-blocked', email: 'blocked@brabo.dev' })
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
      status: 'ready',
      moduleIds: ['api'],
    })
    .returning();
  const [task] = await db
    .insert(tasks)
    .values({ storyId: story.id, title: 'task blocável' })
    .returning();
  return { projectId: project.id, sessionId: session.id, taskId: task.id };
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('MarkTaskBlockedUseCase / UnblockTaskUseCase', () => {
  it('bloqueia: volta pra todo, sem dono, com diagnóstico — e não é reclaimada', async () => {
    const { projectId, sessionId, taskId } = await seed();

    const claimed = await claimNext.execute(
      projectId,
      sessionId,
      'api',
      'dev-api',
    );
    expect(claimed!.id).toBe(taskId);
    expect(claimed!.status).toBe('in_progress');

    const blocked = await markBlocked.execute(
      projectId,
      sessionId,
      taskId,
      'limite de iterações atingido',
      'tentou rodar a suite 8 vezes, sempre falhando',
      'dev-api',
    );

    expect(blocked.status).toBe('todo');
    expect(blocked.assignedTo).toBeNull();
    expect(blocked.blocked).toBe(true);
    expect(blocked.blockedReason).toContain('limite de iterações atingido');
    expect(blocked.blockedReason).toContain('tentou rodar a suite 8 vezes');

    // Task bloqueada NÃO é pegável pelo claim atômico.
    expect(
      await claimNext.execute(projectId, sessionId, 'api', 'dev-api-2'),
    ).toBeNull();
  });

  it('origem (Fase 8b) é opcional — pontos de bloqueio antigos continuam sem ela', async () => {
    const { projectId, sessionId, taskId } = await seed();
    await claimNext.execute(projectId, sessionId, 'api', 'dev-api');

    // Mesma chamada de 6 argumentos que todo call site da Fase 4a já faz —
    // sem o 7º, `origin` fica undefined e persiste como null.
    const blocked = await markBlocked.execute(
      projectId,
      sessionId,
      taskId,
      'limite de iterações atingido',
      'tentou rodar a suite 8 vezes, sempre falhando',
      'dev-api',
    );

    expect(blocked.blockedOrigin).toBeNull();
  });

  it('origem preenchida (Fase 8b, ADR 0020/0038) persiste em blockedOrigin', async () => {
    const { projectId, sessionId, taskId } = await seed();
    await claimNext.execute(projectId, sessionId, 'api', 'dev-api');

    const blocked = await markBlocked.execute(
      projectId,
      sessionId,
      taskId,
      'QA de Automação: QA de Automação não concluiu o parecer',
      'limite de iterações atingido sem emit_qa_verdict',
      'qa-lead',
      'modelo',
    );

    expect(blocked.blockedOrigin).toBe('modelo');
    expect(blocked.blockedReason).toContain('limite de iterações atingido');
  });

  it('unblock também limpa blockedOrigin — nada de rastro do bloqueio anterior', async () => {
    const { projectId, sessionId, taskId } = await seed();
    await claimNext.execute(projectId, sessionId, 'api', 'dev-api');
    await markBlocked.execute(
      projectId,
      sessionId,
      taskId,
      'falhou',
      'diagnóstico',
      'qa-lead',
      'infra',
    );

    const unblocked = await unblock.execute(
      projectId,
      sessionId,
      taskId,
      'user-1',
    );

    expect(unblocked.blockedOrigin).toBeNull();
  });

  it('unblock libera a task pro próximo claim', async () => {
    const { projectId, sessionId, taskId } = await seed();
    await claimNext.execute(projectId, sessionId, 'api', 'dev-api');
    await markBlocked.execute(
      projectId,
      sessionId,
      taskId,
      'orçamento de tokens excedido',
      'gasto: 1000000 (teto: 500000)',
      'dev-api',
    );

    const unblocked = await unblock.execute(
      projectId,
      sessionId,
      taskId,
      'user-1',
    );
    expect(unblocked.blocked).toBe(false);
    expect(unblocked.blockedReason).toBeNull();

    const reclaimed = await claimNext.execute(
      projectId,
      sessionId,
      'api',
      'dev-api-3',
    );
    expect(reclaimed!.id).toBe(taskId);
  });
});
