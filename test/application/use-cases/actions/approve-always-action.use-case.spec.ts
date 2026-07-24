import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotFoundException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  projects,
  sessions,
  users,
  workspaces,
  workspaceMembers,
} from '../../../../src/db/schema';
import { DrizzleUnitOfWork } from '../../../../src/infrastructure/persistence/drizzle/drizzle-unit-of-work';
import { DrizzleSessionRepository } from '../../../../src/infrastructure/persistence/drizzle/session.repository';
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';
import { DrizzleWorkspaceRepository } from '../../../../src/infrastructure/persistence/drizzle/workspace.repository';
import { DrizzleProposedActionRepository } from '../../../../src/infrastructure/persistence/drizzle/proposed-action.repository';
import { DrizzleAgentAutonomyRepository } from '../../../../src/infrastructure/persistence/drizzle/agent-autonomy.repository';
import { DrizzleOutboxRepository } from '../../../../src/infrastructure/persistence/drizzle/outbox.repository';
import { DrizzleSessionEventRepository } from '../../../../src/infrastructure/persistence/drizzle/session-event.repository';
import { FsPermissionsFileStore } from '../../../../src/infrastructure/filesystem/fs-permissions-file-store';
import { ResolveEffectiveRoleUseCase } from '../../../../src/application/use-cases/iam/resolve-effective-role.use-case';
import { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import { ExecuteTerminalActionUseCase } from '../../../../src/application/use-cases/actions/execute-terminal-action.use-case';
import { ProposeActionUseCase } from '../../../../src/application/use-cases/actions/propose-action.use-case';
import { ApproveActionUseCase } from '../../../../src/application/use-cases/actions/approve-action.use-case';
import { ApproveAlwaysActionUseCase } from '../../../../src/application/use-cases/actions/approve-always-action.use-case';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import type { TerminalExecutionResult } from '../../../../src/domain/actions/terminal-execution-result';

const { db, pool } = createTestDb();
const unitOfWork = new DrizzleUnitOfWork(db);
const sessionRepo = new DrizzleSessionRepository(db);
const projectRepo = new DrizzleProjectRepository(db);
const workspaceRepo = new DrizzleWorkspaceRepository(db);
const proposedActionRepo = new DrizzleProposedActionRepository(db);
const agentAutonomyRepo = new DrizzleAgentAutonomyRepository(db);
const outboxRepo = new DrizzleOutboxRepository(db);
const sessionEventRepo = new DrizzleSessionEventRepository(db);
const permissionsFileStore = new FsPermissionsFileStore();
const resolveEffectiveRole = new ResolveEffectiveRoleUseCase(
  projectRepo,
  workspaceRepo,
);
const appendSessionEvent = new AppendSessionEventUseCase(
  unitOfWork,
  sessionRepo,
  sessionEventRepo,
  outboxRepo,
);

const EXEC_RESULT: TerminalExecutionResult = {
  stdout: 'oi\n',
  stderr: '',
  exitCode: 0,
  timedOut: false,
  rawBytes: 3,
  estimatedTokensRaw: 1,
  compressedBytes: null,
  estimatedTokensCompressed: null,
};

class FakeApiToEngineClient implements ApiToEngineClient {
  callCount = 0;
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
  executeTerminalAction(): Promise<TerminalExecutionResult> {
    this.callCount += 1;
    return Promise.resolve(EXEC_RESULT);
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

const proposeAction = new ProposeActionUseCase(
  unitOfWork,
  sessionRepo,
  projectRepo,
  proposedActionRepo,
  agentAutonomyRepo,
  permissionsFileStore,
  outboxRepo,
  resolveEffectiveRole,
  executeTerminalAction,
  undefined as never, // executeGitAction — não exercitado aqui
  undefined as never, // executeInfraPr — não exercitado aqui
);
const approveAction = new ApproveActionUseCase(
  unitOfWork,
  sessionRepo,
  proposedActionRepo,
  outboxRepo,
  executeTerminalAction,
  undefined as never, // executeAdrPr
  undefined as never, // executeInfraPr
  {
    execute: (_p: string, _s: string, a: unknown) => Promise.resolve(a),
  } as unknown as never, // executeGitAction: passthrough
);
const approveAlwaysAction = new ApproveAlwaysActionUseCase(
  proposedActionRepo,
  permissionsFileStore,
  appendSessionEvent,
  approveAction,
);

let workspacesRoot: string;

beforeEach(async () => {
  await truncateAll(db);
  fakeEngineClient.callCount = 0;
  workspacesRoot = await mkdtemp(join(tmpdir(), 'brabo-workspaces-test-'));
  process.env.PROJECT_WORKSPACES_ROOT = workspacesRoot;
});

afterEach(async () => {
  if (workspacesRoot)
    await rm(workspacesRoot, { recursive: true, force: true });
});

afterAll(async () => {
  await pool.end();
});

async function setupPendingTerminalAction(command = 'echo oi') {
  const [user] = await db
    .insert(users)
    .values({
      keycloakSub: 'sub-approve-always',
      email: 'approve-always@brabo.dev',
    })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: user.id })
    .returning();
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId: user.id, role: 'owner' });
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
    actionType: 'terminal',
    actor: { kind: 'agent', id: 'dev-agent' },
    payload: { command },
  });
  return { user, project, session, action };
}

describe('ApproveAlwaysActionUseCase', () => {
  it('aprova, executa, grava o padrão exato em permissions.json/allow e emite permission.granted', async () => {
    const { user, project, session, action } =
      await setupPendingTerminalAction('echo oi');
    expect(action.status).toBe('pending');

    const approved = await approveAlwaysAction.execute(
      project.id,
      session.id,
      action.id,
      user.id,
    );

    expect(approved.status).toBe('executed');
    expect(fakeEngineClient.callCount).toBe(1);

    const file = await permissionsFileStore.read(project.id);
    expect(file.allow).toEqual(['Terminal(echo oi)']);
  });

  it('critério de aceite: propor de novo o MESMO comando depois de approve_always auto-aprova e já executa', async () => {
    const { project, session, user, action } =
      await setupPendingTerminalAction('echo oi');
    await approveAlwaysAction.execute(
      project.id,
      session.id,
      action.id,
      user.id,
    );

    const secondProposal = await proposeAction.execute(project.id, session.id, {
      actionType: 'terminal',
      actor: { kind: 'agent', id: 'dev-agent' },
      payload: { command: 'echo oi' },
    });

    expect(secondProposal.resolvedPolicy).toBe('auto_approve');
    expect(secondProposal.status).toBe('executed');
    expect(fakeEngineClient.callCount).toBe(2); // uma vez no approve_always, outra no auto_approve
  });

  it('404 pra ação inexistente', async () => {
    const { project, session, user } = await setupPendingTerminalAction();
    await expect(
      approveAlwaysAction.execute(
        project.id,
        session.id,
        '00000000-0000-0000-0000-000000000000',
        user.id,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
