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
import { DrizzleDelegationRepository } from '../../../../src/infrastructure/persistence/drizzle/delegation.repository';
import { RecordDelegationUseCase } from '../../../../src/application/use-cases/execution/record-delegation.use-case';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';

const { db, pool } = createTestDb();
const delegationRepo = new DrizzleDelegationRepository(db);

const eventos: Array<{ type: string; payload: unknown }> = [];
const appendStub = {
  execute: (
    _projectId: string,
    _sessionId: string,
    event: { type: string; payload: unknown },
  ) => {
    eventos.push(event);
    return Promise.resolve({});
  },
} as unknown as AppendSessionEventUseCase;

const recordDelegation = new RecordDelegationUseCase(delegationRepo, appendStub);

async function seed() {
  const [owner] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-delegation', email: 'delegation@brabo.dev' })
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
    .values({ storyId: story.id, title: 'task com gate' })
    .returning();
  return { projectId: project.id, sessionId: session.id, taskId: task.id };
}

beforeEach(async () => {
  await truncateAll(db);
  eventos.length = 0;
});

afterAll(async () => {
  await pool.end();
});

describe('RecordDelegationUseCase', () => {
  it('completed exige parecerArtifactId — 400 legível, não erro de constraint', async () => {
    const { projectId, sessionId, taskId } = await seed();

    await expect(
      recordDelegation.execute(projectId, sessionId, {
        taskId,
        area: 'qa',
        leadAgent: 'qa-lead',
        subagent: 'qa-automacao',
        status: 'completed',
      }),
    ).rejects.toThrow(/parecerArtifactId/);
  });

  it('failed exige failureOrigin', async () => {
    const { projectId, sessionId, taskId } = await seed();

    await expect(
      recordDelegation.execute(projectId, sessionId, {
        taskId,
        area: 'qa',
        leadAgent: 'qa-lead',
        subagent: 'qa-automacao',
        status: 'failed',
      }),
    ).rejects.toThrow(/failureOrigin/);
  });

  it('dispensed exige justification — dispensa nunca é silêncio', async () => {
    const { projectId, sessionId, taskId } = await seed();

    await expect(
      recordDelegation.execute(projectId, sessionId, {
        taskId,
        area: 'qa',
        leadAgent: 'qa-lead',
        subagent: 'qa-performance-seguranca',
        status: 'dispensed',
      }),
    ).rejects.toThrow(/justification/);
  });

  it('completed bem formado grava a linha e o evento delegation.completed', async () => {
    const { projectId, sessionId, taskId } = await seed();

    const delegation = await recordDelegation.execute(projectId, sessionId, {
      taskId,
      area: 'qa',
      leadAgent: 'qa-lead',
      subagent: 'qa-automacao',
      status: 'completed',
      parecerArtifactId: 'evt_01jc4z0000parecer000000001',
    });

    expect(delegation.status).toBe('completed');
    expect(delegation.parecerArtifactId).toBe(
      'evt_01jc4z0000parecer000000001',
    );
    expect(delegation.failureOrigin).toBeNull();

    expect(eventos).toHaveLength(1);
    expect(eventos[0].type).toBe('delegation.completed');
  });

  it('failed bem formado grava origem e evento delegation.failed', async () => {
    const { projectId, sessionId, taskId } = await seed();

    const delegation = await recordDelegation.execute(projectId, sessionId, {
      taskId,
      area: 'qa',
      leadAgent: 'qa-lead',
      subagent: 'qa-automacao',
      status: 'failed',
      failureOrigin: 'infra',
      failureReason: 'worktree sumiu',
    });

    expect(delegation.status).toBe('failed');
    expect(delegation.failureOrigin).toBe('infra');
    expect(eventos[0].type).toBe('delegation.failed');
  });

  it('dispensed bem formado grava a justificativa e evento delegation.dispensed', async () => {
    const { projectId, sessionId, taskId } = await seed();

    const delegation = await recordDelegation.execute(projectId, sessionId, {
      taskId,
      area: 'qa',
      leadAgent: 'qa-lead',
      subagent: 'qa-performance-seguranca',
      status: 'dispensed',
      justification: 'story sem RNF de performance pertinente',
    });

    expect(delegation.status).toBe('dispensed');
    expect(delegation.justification).toBe(
      'story sem RNF de performance pertinente',
    );
    expect(eventos[0].type).toBe('delegation.dispensed');
  });

  it('findByTask lista as delegações de uma task, na ordem em que foram criadas', async () => {
    const { projectId, sessionId, taskId } = await seed();

    await recordDelegation.execute(projectId, sessionId, {
      taskId,
      area: 'qa',
      leadAgent: 'qa-lead',
      subagent: 'qa-automacao',
      status: 'completed',
      parecerArtifactId: 'evt-1',
    });
    await recordDelegation.execute(projectId, sessionId, {
      taskId,
      area: 'qa',
      leadAgent: 'qa-lead',
      subagent: 'qa-performance-seguranca',
      status: 'dispensed',
      justification: 'sem RNF de performance',
    });

    const delegacoes = await delegationRepo.findByTask(taskId);
    expect(delegacoes).toHaveLength(2);
    expect(delegacoes.map((d) => d.subagent)).toEqual([
      'qa-automacao',
      'qa-performance-seguranca',
    ]);
  });

  it('área sem task de backlog (Infra, Fase 8c) grava taskId null', async () => {
    const { projectId, sessionId } = await seed();

    const delegation = await recordDelegation.execute(projectId, sessionId, {
      area: 'infra',
      leadAgent: 'infra',
      subagent: 'infra-workflows',
      status: 'completed',
      parecerArtifactId: 'evt_01jc4z0000infrafiles00001',
    });

    expect(delegation.taskId).toBeNull();
    expect(delegation.area).toBe('infra');
    expect(eventos[0].type).toBe('delegation.completed');
  });
});
