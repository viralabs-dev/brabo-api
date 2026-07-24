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
import type { Role } from '../../../../src/domain/iam/role';
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

const DEFAULT_RESULT: TerminalExecutionResult = {
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
  calls: Array<{ actionId: string; command: string }> = [];
  nextResult: TerminalExecutionResult = DEFAULT_RESULT;

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

  executeTerminalAction(
    _projectId: string,
    _sessionId: string,
    actionId: string,
    command: string,
  ) {
    this.calls.push({ actionId, command });
    return Promise.resolve(this.nextResult);
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

let workspacesRoot: string;

beforeEach(async () => {
  await truncateAll(db);
  fakeEngineClient.calls = [];
  fakeEngineClient.nextResult = DEFAULT_RESULT;
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

async function setupSession(role: Role = 'owner') {
  const [user] = await db
    .insert(users)
    .values({
      keycloakSub: 'sub-propose-actions',
      email: 'propose-actions@brabo.dev',
    })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: user.id })
    .returning();
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId: user.id, role });
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

describe('ProposeActionUseCase', () => {
  it('sem regra em permissions.json, cria a ação como pending', async () => {
    const { project, session } = await setupSession();

    const action = await proposeAction.execute(project.id, session.id, {
      actionType: 'terminal',
      actor: { kind: 'agent', id: 'dev-agent' },
      payload: { command: 'echo oi' },
    });

    expect(action.status).toBe('pending');
    expect(action.resolvedPolicy).toBe('require_approval');
    expect(fakeEngineClient.calls).toHaveLength(0);
  });

  it('write_file (agente, sem regra) cria proposed_action pending, sem executar', async () => {
    const { project, session } = await setupSession();

    const action = await proposeAction.execute(project.id, session.id, {
      actionType: 'write_file',
      actor: { kind: 'agent', id: 'echo' },
      payload: { path: 'src/app.ts', content: 'export const x = 1;' },
    });

    expect(action.actionType).toBe('write_file');
    expect(action.status).toBe('pending');
    expect(action.resolvedPolicy).toBe('require_approval');
    // write_file nunca é auto-executado nesta fase (branch de auto-exec é
    // terminal-only) — o engine não é chamado.
    expect(fakeEngineClient.calls).toHaveLength(0);
  });

  it('allow em permissions.json: auto-aprova e JÁ EXECUTA (terminal)', async () => {
    const { project, session } = await setupSession();
    await permissionsFileStore.write(project.id, {
      allow: ['Terminal(echo oi)'],
      deny: [],
      ask: [],
    });

    const action = await proposeAction.execute(project.id, session.id, {
      actionType: 'terminal',
      actor: { kind: 'agent', id: 'dev-agent' },
      payload: { command: 'echo oi' },
    });

    expect(action.resolvedPolicy).toBe('auto_approve');
    expect(action.status).toBe('executed');
    expect(action.executionResult).toEqual(DEFAULT_RESULT);
    expect(fakeEngineClient.calls).toEqual([
      { actionId: action.id, command: 'echo oi' },
    ]);
  });

  it('deny embutido (rm -rf /) nega mesmo sem nenhuma regra configurada, sem executar', async () => {
    const { project, session } = await setupSession();

    const action = await proposeAction.execute(project.id, session.id, {
      actionType: 'terminal',
      actor: { kind: 'agent', id: 'dev-agent' },
      payload: { command: 'rm -rf /' },
    });

    expect(action.status).toBe('denied');
    expect(action.resolvedPolicy).toBe('deny');
    expect(action.rejectionReason).toBeTruthy();
    expect(fakeEngineClient.calls).toHaveLength(0);
  });

  it('IAM insuficiente nega git_push pra papel developer, mesmo sem regra de deny', async () => {
    const { project, session } = await setupSession('developer');

    const action = await proposeAction.execute(project.id, session.id, {
      actionType: 'git_push',
      actor: { kind: 'user', id: 'u1' },
      payload: {},
    });

    expect(action.status).toBe('denied');
    expect(action.resolvedPolicy).toBe('deny');
  });

  it('InfraAgent propondo terminal vira denied mesmo com allow amplo em permissions.json (Fase 4a — defesa em profundidade)', async () => {
    const { project, session } = await setupSession();
    await agentAutonomyRepo.upsert(project.id, 'infra', 'terminal', 'deny');
    await permissionsFileStore.write(project.id, {
      allow: ['Terminal(*)'],
      deny: [],
      ask: [],
    });

    const action = await proposeAction.execute(project.id, session.id, {
      actionType: 'terminal',
      actor: { kind: 'agent', id: 'infra' },
      payload: { command: 'curl http://example.com' },
    });

    expect(action.status).toBe('denied');
    expect(action.resolvedPolicy).toBe('deny');
    expect(fakeEngineClient.calls).toHaveLength(0);
  });

  it('rejeita tipo de ação desconhecido', async () => {
    const { project, session } = await setupSession();
    await expect(
      proposeAction.execute(project.id, session.id, {
        actionType: 'delete_everything',
        actor: { kind: 'user', id: 'u1' },
        payload: {},
      }),
    ).rejects.toThrow();
  });

  it('rejeita propor ação em sessão inexistente', async () => {
    const { project } = await setupSession();
    await expect(
      proposeAction.execute(
        project.id,
        '00000000-0000-0000-0000-000000000000',
        {
          actionType: 'terminal',
          actor: { kind: 'user', id: 'u1' },
          payload: { command: 'echo oi' },
        },
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
