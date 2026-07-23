import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  projects,
  sessions,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { InvalidActionTransitionError } from '../../../../src/domain/actions/action-state-machine';
import { DrizzleUnitOfWork } from '../../../../src/infrastructure/persistence/drizzle/drizzle-unit-of-work';
import { DrizzleSessionRepository } from '../../../../src/infrastructure/persistence/drizzle/session.repository';
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';
import { DrizzleProposedActionRepository } from '../../../../src/infrastructure/persistence/drizzle/proposed-action.repository';
import { DrizzleOutboxRepository } from '../../../../src/infrastructure/persistence/drizzle/outbox.repository';
import { ProposeActionUseCase } from '../../../../src/application/use-cases/actions/propose-action.use-case';
import { ApproveActionUseCase } from '../../../../src/application/use-cases/actions/approve-action.use-case';
import { RejectActionUseCase } from '../../../../src/application/use-cases/actions/reject-action.use-case';

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
const approveAction = new ApproveActionUseCase(
  unitOfWork,
  sessionRepo,
  proposedActionRepo,
  outboxRepo,
);
const rejectAction = new RejectActionUseCase(
  unitOfWork,
  sessionRepo,
  proposedActionRepo,
  outboxRepo,
);

async function setupPendingAction() {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-decide', email: 'decide@brabo.dev' })
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
  const [session] = await db
    .insert(sessions)
    .values({ projectId: project.id, createdBy: user.id })
    .returning();
  const action = await proposeAction.execute(project.id, session.id, {
    actionType: 'shell.exec',
    actor: { kind: 'agent', id: 'dev-agent' },
    payload: {},
  });
  return { user, project, session, action };
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('ApproveActionUseCase', () => {
  it('caminho feliz: aprova uma ação proposed e grava decidedBy/decidedAt', async () => {
    const { user, project, session, action } = await setupPendingAction();

    const approved = await approveAction.execute(
      project.id,
      session.id,
      action.id,
      user.id,
    );

    expect(approved.status).toBe('approved');
    expect(approved.decidedBy).toBe(user.id);
    expect(approved.decidedAt).not.toBeNull();
  });

  it('rejeita aprovar uma ação já decidida', async () => {
    const { user, project, session, action } = await setupPendingAction();
    await approveAction.execute(project.id, session.id, action.id, user.id);

    await expect(
      approveAction.execute(project.id, session.id, action.id, user.id),
    ).rejects.toThrow(InvalidActionTransitionError);
  });

  it('404 pra sessão inexistente', async () => {
    const { user, project, action } = await setupPendingAction();
    await expect(
      approveAction.execute(
        project.id,
        '00000000-0000-0000-0000-000000000000',
        action.id,
        user.id,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('404 pra ação inexistente', async () => {
    const { user, project, session } = await setupPendingAction();
    await expect(
      approveAction.execute(
        project.id,
        session.id,
        '00000000-0000-0000-0000-000000000000',
        user.id,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('RejectActionUseCase', () => {
  it('caminho feliz: rejeita uma ação proposed e grava o motivo', async () => {
    const { user, project, session, action } = await setupPendingAction();

    const rejected = await rejectAction.execute(
      project.id,
      session.id,
      action.id,
      user.id,
      'não autorizado neste horário',
    );

    expect(rejected.status).toBe('rejected');
    expect(rejected.decidedBy).toBe(user.id);
    expect(rejected.rejectionReason).toBe('não autorizado neste horário');
  });

  it('rejeita decidir uma ação já decidida', async () => {
    const { user, project, session, action } = await setupPendingAction();
    await rejectAction.execute(project.id, session.id, action.id, user.id);

    await expect(
      rejectAction.execute(project.id, session.id, action.id, user.id),
    ).rejects.toThrow(InvalidActionTransitionError);
  });
});
