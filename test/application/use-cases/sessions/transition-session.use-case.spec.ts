import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  outboxEvents,
  projects,
  sessions,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleUnitOfWork } from '../../../../src/infrastructure/persistence/drizzle/drizzle-unit-of-work';
import { DrizzleSessionRepository } from '../../../../src/infrastructure/persistence/drizzle/session.repository';
import { DrizzleOutboxRepository } from '../../../../src/infrastructure/persistence/drizzle/outbox.repository';
import { TransitionSessionUseCase } from '../../../../src/application/use-cases/sessions/transition-session.use-case';
import { GRAPH_PROJECTION_AGGREGATE_TYPE } from '../../../../src/domain/graph/graph-projection-events';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';

const { db, pool } = createTestDb();
const unitOfWork = new DrizzleUnitOfWork(db);
const sessionRepo = new DrizzleSessionRepository(db);
const outboxRepo = new DrizzleOutboxRepository(db);

// O engine nunca é chamado numa transição terminal (só `to === 'active'`
// chama `startSession`) — qualquer chamada aqui seria um bug.
const engineClient = {
  startSession: () => {
    throw new Error('engine não deveria ser chamado numa transição terminal');
  },
} as unknown as ApiToEngineClient;

const transitionSession = new TransitionSessionUseCase(
  unitOfWork,
  sessionRepo,
  outboxRepo,
  engineClient,
);

async function setupActiveSession() {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-transition', email: 'transition@brabo.dev' })
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
    .values({ projectId: project.id, createdBy: user.id, status: 'active' })
    .returning();
  return { project, session };
}

async function graphProjectionRows(sessionId: string) {
  return db
    .select()
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.aggregateId, sessionId),
        eq(outboxEvents.aggregateType, GRAPH_PROJECTION_AGGREGATE_TYPE),
      ),
    );
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('TransitionSessionUseCase — projeção do grafo (Onda 2)', () => {
  it('closed: grava, na MESMA transação, uma segunda linha de outbox (graph_projection) para o GraphProjector consolidar a Interacao', async () => {
    const { project, session } = await setupActiveSession();

    // active -> closed direto é transição inválida (RN da máquina de
    // estados) — o caminho real passa por closing primeiro.
    await transitionSession.execute(project.id, session.id, 'closing');
    await transitionSession.execute(project.id, session.id, 'closed');

    const rows = await graphProjectionRows(session.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe('session.closed');
    expect(rows[0].payload).toEqual({
      sessionId: session.id,
      projectId: project.id,
    });
    expect(rows[0].processedAt).toBeNull();

    // A linha 'session' de sempre continua sendo gravada do lado dela.
    const sessionRows = await db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.aggregateId, session.id),
          eq(outboxEvents.aggregateType, 'session'),
        ),
      );
    expect(sessionRows).toHaveLength(1);
    expect(sessionRows[0].eventType).toBe('session.closed');
  });

  it('closed_abnormally: mesma segunda linha, com o eventType correspondente', async () => {
    const { project, session } = await setupActiveSession();

    await transitionSession.execute(project.id, session.id, 'closed_abnormally');

    const rows = await graphProjectionRows(session.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe('session.closed_abnormally');
  });

  it('closing (não terminal) NÃO grava linha nenhuma de graph_projection', async () => {
    const { project, session } = await setupActiveSession();

    await transitionSession.execute(project.id, session.id, 'closing');

    const rows = await graphProjectionRows(session.id);
    expect(rows).toHaveLength(0);
  });
});
