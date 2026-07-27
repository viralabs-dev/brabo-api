import { describe, it, expect, beforeEach, afterAll } from 'vitest';
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
import { ReportSessionTerminationUseCase } from '../../../../src/application/use-cases/sessions/report-session-termination.use-case';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';

const { db, pool } = createTestDb();
const unitOfWork = new DrizzleUnitOfWork(db);
const sessionRepo = new DrizzleSessionRepository(db);
const outboxRepo = new DrizzleOutboxRepository(db);

// O engine nunca é chamado nesse caminho (transições terminais não
// chamam startSession) — qualquer chamada aqui seria um bug.
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
const reportTermination = new ReportSessionTerminationUseCase(
  transitionSession,
  sessionRepo,
);

async function setupActiveSession() {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-report-term', email: 'report-term@brabo.dev' })
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

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('ReportSessionTerminationUseCase', () => {
  it('término anormal: grava o motivo em sessions.termination_reason (Fase 4b)', async () => {
    const { project, session } = await setupActiveSession();

    const updated = await reportTermination.execute(
      project.id,
      session.id,
      'closed_abnormally',
      'killed',
    );

    expect(updated.status).toBe('closed_abnormally');
    expect(updated.terminationReason).toBe('killed');
  });

  it('heartbeat_timeout -> closed (com hop implícito active->closing) preserva o motivo', async () => {
    const { project, session } = await setupActiveSession();

    const updated = await reportTermination.execute(
      project.id,
      session.id,
      'closed',
      'heartbeat_timeout',
    );

    expect(updated.status).toBe('closed');
    expect(updated.terminationReason).toBe('heartbeat_timeout');
  });

  it('sem motivo informado: termination_reason fica null (fecho gracioso)', async () => {
    const { project, session } = await setupActiveSession();

    const updated = await reportTermination.execute(
      project.id,
      session.id,
      'closed_abnormally',
    );

    expect(updated.status).toBe('closed_abnormally');
    expect(updated.terminationReason).toBeNull();
  });

  // --- Drain de shutdown do engine (Fase 5, item 4) ---------------------

  it('aceita `closing` vindo do engine e PRESERVA a causa', async () => {
    const { project, session } = await setupActiveSession();

    // Antes da Fase 5 isto era impossível por dois motivos independentes: o
    // DTO travava em ['closed','closed_abnormally'], e `termination_reason`
    // só era persistido em estado terminal — a causa do drain seria
    // descartada exatamente onde o Psicólogo vai lê-la depois.
    const updated = await reportTermination.execute(
      project.id,
      session.id,
      'closing',
      'node_shutdown',
    );

    expect(updated.status).toBe('closing');
    expect(updated.terminationReason).toBe('node_shutdown');
  });

  it('closing -> closed_abnormally: o drain completo mantém a causa', async () => {
    const { project, session } = await setupActiveSession();

    await reportTermination.execute(
      project.id,
      session.id,
      'closing',
      'node_shutdown',
    );
    const updated = await reportTermination.execute(
      project.id,
      session.id,
      'closed_abnormally',
      'node_shutdown',
    );

    expect(updated.status).toBe('closed_abnormally');
    expect(updated.terminationReason).toBe('node_shutdown');
    expect(updated.closedAt).not.toBeNull();
  });

  it('`closing` NÃO emite evento de outbox — só estado terminal emite', async () => {
    const { project, session } = await setupActiveSession();

    await reportTermination.execute(
      project.id,
      session.id,
      'closing',
      'node_shutdown',
    );

    // Se `closing` emitisse, todo rollout dispararia uma análise do Psicólogo
    // (com custo de LLM) por sessão, e a sessão adotada por outra réplica
    // seria analisada como se tivesse terminado.
    const events = await db.select().from(outboxEvents);
    expect(events).toHaveLength(0);
  });
});
