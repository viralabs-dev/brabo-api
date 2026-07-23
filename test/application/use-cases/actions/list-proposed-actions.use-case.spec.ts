import { describe, it, expect, beforeEach, afterAll } from 'vitest';
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
import { ListProposedActionsUseCase } from '../../../../src/application/use-cases/actions/list-proposed-actions.use-case';

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
const listProposedActions = new ListProposedActionsUseCase(
  sessionRepo,
  proposedActionRepo,
);

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('ListProposedActionsUseCase', () => {
  it('lista ações propostas paginadas em ordem crescente de seq', async () => {
    const [user] = await db
      .insert(users)
      .values({ keycloakSub: 'sub-list', email: 'list@brabo.dev' })
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

    for (let i = 0; i < 3; i++) {
      await proposeAction.execute(project.id, session.id, {
        actionType: `action.${i}`,
        actor: { kind: 'user', id: user.id },
        payload: {},
      });
    }

    const page = await listProposedActions.execute(project.id, session.id, {});
    expect(page.items.map((a) => a.actionType)).toEqual([
      'action.0',
      'action.1',
      'action.2',
    ]);
    expect(page.items.map((a) => a.seq)).toEqual([1, 2, 3]);
  });
});
