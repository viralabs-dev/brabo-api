import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { ListProposedActionsUseCase } from '../../../../src/application/use-cases/actions/list-proposed-actions.use-case';
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

class FakeApiToEngineClient implements ApiToEngineClient {
  async startSession(): Promise<void> {}
  async startAgent(): Promise<void> {}
  async sendAgentMessage(): Promise<void> {}
  async confirmReadiness(): Promise<void> {}
  async startExecution(): Promise<void> {}
  async executeGitAction(): Promise<Record<string, unknown>> {
    return {};
  }
  async acceptParallelization(): Promise<void> {}
  async rearmDevAgent(): Promise<void> {}
  async reviseStory(): Promise<void> {}
  async offerInfraHandoff(): Promise<void> {}
  async reanalyzeSession(): Promise<void> {}
  async runAnamnese(): Promise<void> {}
  async invalidateInstructions(): Promise<void> {}
  executeTerminalAction(): Promise<TerminalExecutionResult> {
    return Promise.resolve({
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      rawBytes: 0,
      estimatedTokensRaw: 0,
      compressedBytes: null,
      estimatedTokensCompressed: null,
    });
  }
}

const executeTerminalAction = new ExecuteTerminalActionUseCase(
  unitOfWork,
  proposedActionRepo,
  appendSessionEvent,
  outboxRepo,
  new FakeApiToEngineClient(),
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
  appendSessionEvent,
);
const listProposedActions = new ListProposedActionsUseCase(
  sessionRepo,
  proposedActionRepo,
);

let workspacesRoot: string;

beforeEach(async () => {
  await truncateAll(db);
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

    for (let i = 0; i < 3; i++) {
      await proposeAction.execute(project.id, session.id, {
        actionType: 'terminal',
        actor: { kind: 'user', id: user.id },
        payload: { command: `echo ${i}` },
      });
    }

    const page = await listProposedActions.execute(project.id, session.id, {});
    expect(
      page.items.map((a) => (a.payload as { command: string }).command),
    ).toEqual(['echo 0', 'echo 1', 'echo 2']);
    expect(page.items.map((a) => a.seq)).toEqual([1, 2, 3]);
  });
});
