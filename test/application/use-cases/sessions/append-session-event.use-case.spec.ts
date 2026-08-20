import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  outboxEvents,
  projects,
  sessionEvents,
  sessions,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleUnitOfWork } from '../../../../src/infrastructure/persistence/drizzle/drizzle-unit-of-work';
import { DrizzleSessionRepository } from '../../../../src/infrastructure/persistence/drizzle/session.repository';
import { DrizzleSessionEventRepository } from '../../../../src/infrastructure/persistence/drizzle/session-event.repository';
import { DrizzleOutboxRepository } from '../../../../src/infrastructure/persistence/drizzle/outbox.repository';
import { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import { ListSessionEventsUseCase } from '../../../../src/application/use-cases/sessions/list-session-events.use-case';
import { GRAPH_PROJECTION_AGGREGATE_TYPE } from '../../../../src/domain/graph/graph-projection-events';

const { db, pool } = createTestDb();
const unitOfWork = new DrizzleUnitOfWork(db);
const sessionRepo = new DrizzleSessionRepository(db);
const sessionEventRepo = new DrizzleSessionEventRepository(db);
const outboxRepo = new DrizzleOutboxRepository(db);

const appendSessionEvent = new AppendSessionEventUseCase(
  unitOfWork,
  sessionRepo,
  sessionEventRepo,
  outboxRepo,
);
const listSessionEvents = new ListSessionEventsUseCase(
  sessionRepo,
  sessionEventRepo,
);

async function setupSession() {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-events', email: 'events@brabo.dev' })
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
  return { user, workspace, project, session };
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('AppendSessionEventUseCase', () => {
  it('caminho feliz: anexa um evento com seq 1 e envelope correto', async () => {
    const { project, session, user } = await setupSession();

    const event = await appendSessionEvent.execute(project.id, session.id, {
      type: 'message.sent',
      actor: { kind: 'user', id: user.id },
      payload: { text: 'oi' },
    });

    expect(event.seq).toBe(1);
    expect(event.type).toBe('message.sent');
    expect(event.actor).toEqual({ kind: 'user', id: user.id });
    expect(event.payload).toEqual({ text: 'oi' });
  });

  it('rejeita anexar em sessão inexistente', async () => {
    const { project } = await setupSession();
    await expect(
      appendSessionEvent.execute(
        project.id,
        '00000000-0000-0000-0000-000000000000',
        {
          type: 'message.sent',
          actor: { kind: 'system', id: 'system' },
          payload: {},
        },
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('seq sem gaps sob escrita concorrente', async () => {
    const { project, session } = await setupSession();
    const CONCURRENCY = 20;

    await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        appendSessionEvent.execute(project.id, session.id, {
          type: 'concurrent.write',
          actor: { kind: 'agent', id: `agent-${i}` },
          payload: { i },
        }),
      ),
    );

    const rows = await db
      .select({ seq: sessionEvents.seq })
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, session.id))
      .orderBy(asc(sessionEvents.seq));

    const seqs = rows.map((r) => r.seq);
    expect(seqs).toHaveLength(CONCURRENCY);
    expect(seqs).toEqual(Array.from({ length: CONCURRENCY }, (_, i) => i + 1));
  });

  it('lista eventos paginados em ordem crescente de seq', async () => {
    const { project, session, user } = await setupSession();
    for (let i = 0; i < 3; i++) {
      await appendSessionEvent.execute(project.id, session.id, {
        type: `event.${i}`,
        actor: { kind: 'user', id: user.id },
        payload: {},
      });
    }

    const page = await listSessionEvents.execute(project.id, session.id, {});
    expect(page.items.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('tipo projetável no grafo (ex. handoff.offered) grava uma SEGUNDA linha de outbox, aggregateType graph_projection, na mesma transação', async () => {
    const { project, session } = await setupSession();

    const event = await appendSessionEvent.execute(project.id, session.id, {
      type: 'handoff.offered',
      actor: { kind: 'agent', id: 'po' },
      payload: { handoffId: 'h-1', toAgent: 'arquiteto' },
    });

    const rows = await db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.aggregateId, session.id),
          eq(outboxEvents.aggregateType, GRAPH_PROJECTION_AGGREGATE_TYPE),
        ),
      );

    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe('handoff.offered');
    expect(rows[0].payload).toEqual({ eventId: event.id });
    expect(rows[0].processedAt).toBeNull();

    // A linha 'session' de sempre continua sendo gravada do lado dela —
    // a projeção do grafo é ADITIVA, nunca substitui o outbox existente.
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
  });

  it('tipo NÃO projetável (ex. message.sent) não grava linha nenhuma em graph_projection', async () => {
    const { project, session, user } = await setupSession();

    await appendSessionEvent.execute(project.id, session.id, {
      type: 'message.sent',
      actor: { kind: 'user', id: user.id },
      payload: { text: 'oi' },
    });

    const rows = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateType, GRAPH_PROJECTION_AGGREGATE_TYPE));

    expect(rows).toHaveLength(0);
  });
});
