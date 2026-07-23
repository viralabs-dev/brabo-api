import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  projects,
  sessions,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleUnitOfWork } from '../../../../src/infrastructure/persistence/drizzle/drizzle-unit-of-work';
import { DrizzleSessionRepository } from '../../../../src/infrastructure/persistence/drizzle/session.repository';
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';
import { DrizzleProposedActionRepository } from '../../../../src/infrastructure/persistence/drizzle/proposed-action.repository';
import { DrizzleOutboxRepository } from '../../../../src/infrastructure/persistence/drizzle/outbox.repository';
import { ProposeActionUseCase } from '../../../../src/application/use-cases/actions/propose-action.use-case';
import type { PermissionsConfig } from '../../../../src/domain/actions/permission-resolver';

const { db, pool } = createTestDb();
const unitOfWork = new DrizzleUnitOfWork(db);
const sessionRepo = new DrizzleSessionRepository(db);
const projectRepo = new DrizzleProjectRepository(db);
const proposedActionRepo = new DrizzleProposedActionRepository(db);
const outboxRepo = new DrizzleOutboxRepository(db);

const proposeAction = new ProposeActionUseCase(
  unitOfWork,
  sessionRepo,
  projectRepo,
  proposedActionRepo,
  outboxRepo,
);

async function setupSession(permissions?: PermissionsConfig) {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-actions', email: 'actions@brabo.dev' })
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
      ...(permissions ? { permissions } : {}),
    })
    .returning();
  const [session] = await db
    .insert(sessions)
    .values({ projectId: project.id, createdBy: user.id })
    .returning();
  return { user, workspace, project, session };
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('ProposeActionUseCase', () => {
  it('auto_approve: cria a ação já como auto_approved', async () => {
    const { project, session } = await setupSession({
      rules: [{ actionType: 'shell.*', policy: 'auto_approve' }],
    });

    const action = await proposeAction.execute(project.id, session.id, {
      actionType: 'shell.exec',
      actor: { kind: 'agent', id: 'dev-agent' },
      payload: { cmd: 'ls' },
    });

    expect(action.status).toBe('auto_approved');
    expect(action.resolvedPolicy).toBe('auto_approve');
    expect(action.rejectionReason).toBeNull();
  });

  it('deny: cria a ação já rejeitada com motivo automático', async () => {
    const { project, session } = await setupSession({
      rules: [{ actionType: 'shell.*', policy: 'deny' }],
    });

    const action = await proposeAction.execute(project.id, session.id, {
      actionType: 'shell.exec',
      actor: { kind: 'agent', id: 'dev-agent' },
      payload: {},
    });

    expect(action.status).toBe('rejected');
    expect(action.resolvedPolicy).toBe('deny');
    expect(action.rejectionReason).toContain('shell.exec');
  });

  it('require_approval (ou sem regra): cria a ação como proposed', async () => {
    const { project, session } = await setupSession();

    const action = await proposeAction.execute(project.id, session.id, {
      actionType: 'shell.exec',
      actor: { kind: 'user', id: 'u1' },
      payload: {},
    });

    expect(action.status).toBe('proposed');
    expect(action.resolvedPolicy).toBe('require_approval');
  });

  it('rejeita propor ação em sessão inexistente', async () => {
    const { project } = await setupSession();
    await expect(
      proposeAction.execute(
        project.id,
        '00000000-0000-0000-0000-000000000000',
        {
          actionType: 'shell.exec',
          actor: { kind: 'user', id: 'u1' },
          payload: {},
        },
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
