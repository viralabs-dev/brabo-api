import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  projects,
  sessions,
  users,
  workspaces,
  sessionEvents,
} from '../../../../src/db/schema';
import { DrizzleUnitOfWork } from '../../../../src/infrastructure/persistence/drizzle/drizzle-unit-of-work';
import { DrizzleSessionRepository } from '../../../../src/infrastructure/persistence/drizzle/session.repository';
import { DrizzleProposedActionRepository } from '../../../../src/infrastructure/persistence/drizzle/proposed-action.repository';
import { DrizzleOutboxRepository } from '../../../../src/infrastructure/persistence/drizzle/outbox.repository';
import { DrizzleSessionEventRepository } from '../../../../src/infrastructure/persistence/drizzle/session-event.repository';
import { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import { ExecuteTerminalActionUseCase } from '../../../../src/application/use-cases/actions/execute-terminal-action.use-case';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import type { TerminalExecutionResult } from '../../../../src/domain/actions/terminal-execution-result';

const { db, pool } = createTestDb();
const unitOfWork = new DrizzleUnitOfWork(db);
const sessionRepo = new DrizzleSessionRepository(db);
const proposedActionRepo = new DrizzleProposedActionRepository(db);
const outboxRepo = new DrizzleOutboxRepository(db);
const sessionEventRepo = new DrizzleSessionEventRepository(db);
const appendSessionEvent = new AppendSessionEventUseCase(
  unitOfWork,
  sessionRepo,
  sessionEventRepo,
  outboxRepo,
);

class FakeApiToEngineClient implements ApiToEngineClient {
  result: TerminalExecutionResult | null = null;
  error: Error | null = null;

  async startSession(): Promise<void> {}
  async startAgent(): Promise<void> {}
  async sendAgentMessage(): Promise<void> {}
  async confirmReadiness(): Promise<void> {}
  async startExecution(): Promise<void> {}
  async executeGitAction(): Promise<Record<string, unknown>> {
    return {};
  }
  async acceptParallelization(): Promise<void> {}
  async offerInfraHandoff(): Promise<void> {}
  async reanalyzeSession(): Promise<void> {}
  async runAnamnese(): Promise<void> {}
  async invalidateInstructions(): Promise<void> {}

  executeTerminalAction(): Promise<TerminalExecutionResult> {
    if (this.error) return Promise.reject(this.error);
    return Promise.resolve(this.result!);
  }
}

const fakeEngineClient = new FakeApiToEngineClient();
const executeTerminalAction = new ExecuteTerminalActionUseCase(
  unitOfWork,
  proposedActionRepo,
  appendSessionEvent,
  outboxRepo,
  fakeEngineClient,
);

beforeEach(async () => {
  await truncateAll(db);
  fakeEngineClient.result = null;
  fakeEngineClient.error = null;
});

afterAll(async () => {
  await pool.end();
});

async function setupApprovedAction(command = 'echo oi') {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-execute', email: 'execute@brabo.dev' })
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
  const action = await proposedActionRepo.create({
    projectId: project.id,
    sessionId: session.id,
    actionType: 'terminal',
    payload: { command },
    status: 'approved',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'agent', id: 'dev-agent' },
  });
  return { project, session, action };
}

describe('ExecuteTerminalActionUseCase', () => {
  it('exitCode 0: grava status executed e evento action.executed', async () => {
    const { project, session, action } = await setupApprovedAction();
    fakeEngineClient.result = {
      stdout: 'oi\n',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      rawBytes: 3,
      estimatedTokensRaw: 1,
      compressedBytes: null,
      estimatedTokensCompressed: null,
    };

    const updated = await executeTerminalAction.execute(
      project.id,
      session.id,
      action,
    );

    expect(updated.status).toBe('executed');
    expect((updated.executionResult as TerminalExecutionResult)?.stdout).toBe(
      'oi\n',
    );

    const events = await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, session.id));
    expect(events.map((e) => e.type)).toContain('action.executed');
  });

  it('exitCode != 0: grava status failed', async () => {
    const { project, session, action } = await setupApprovedAction();
    fakeEngineClient.result = {
      stdout: '',
      stderr: 'comando não encontrado',
      exitCode: 127,
      timedOut: false,
      rawBytes: 0,
      estimatedTokensRaw: 0,
      compressedBytes: null,
      estimatedTokensCompressed: null,
    };

    const updated = await executeTerminalAction.execute(
      project.id,
      session.id,
      action,
    );

    expect(updated.status).toBe('failed');
  });

  it('falha de transporte (engine inalcançável) grava failed com o erro no stderr, nunca deixa a ação presa', async () => {
    const { project, session, action } = await setupApprovedAction();
    fakeEngineClient.error = new Error('engine indisponível');

    const updated = await executeTerminalAction.execute(
      project.id,
      session.id,
      action,
    );

    expect(updated.status).toBe('failed');
    expect(
      (updated.executionResult as TerminalExecutionResult)?.stderr,
    ).toContain('engine indisponível');
  });
});
