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
import { InvalidActionTransitionError } from '../../../../src/domain/actions/action-state-machine';
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
import { DenyActionUseCase } from '../../../../src/application/use-cases/actions/deny-action.use-case';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import type { TerminalExecutionResult } from '../../../../src/domain/actions/terminal-execution-result';
import { BraboMetrics } from '../../../../src/infrastructure/observability/brabo-metrics';

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
);
const approveAction = new ApproveActionUseCase(
  unitOfWork,
  sessionRepo,
  proposedActionRepo,
  outboxRepo,
  executeTerminalAction,
  undefined as never, // executeAdrPr — não exercitado aqui
  undefined as never, // executeInfraPr — não exercitado aqui
  // executeGitAction: passthrough (o executor git de verdade é testado à parte).
  {
    execute: (_p: string, _s: string, a: unknown) => Promise.resolve(a),
  } as unknown as never,
  undefined as never, // executeInstructionPatch — não exercitado aqui,
  new BraboMetrics(),
);
const denyAction = new DenyActionUseCase(
  unitOfWork,
  sessionRepo,
  proposedActionRepo,
  outboxRepo,
  new BraboMetrics(),
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

async function setupPendingAction() {
  const [user] = await db
    .insert(users)
    .values({
      keycloakSub: 'sub-approve-deny',
      email: 'approve-deny@brabo.dev',
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
  // git_push nunca auto-aprova/nega sozinho sem regra (papel owner >= min,
  // sem autonomy, sem regra no arquivo) — fica pending, ideal pra testar
  // approve/deny manuais sem interferência do executor de terminal.
  const action = await proposeAction.execute(project.id, session.id, {
    actionType: 'git_push',
    actor: { kind: 'agent', id: 'dev-agent' },
    payload: {},
  });
  return { user, project, session, action };
}

describe('ApproveActionUseCase', () => {
  it('caminho feliz: aprova uma ação pending e grava decidedBy/decidedAt', async () => {
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

describe('DenyActionUseCase', () => {
  it('caminho feliz: nega uma ação pending e grava o motivo', async () => {
    const { user, project, session, action } = await setupPendingAction();

    const denied = await denyAction.execute(
      project.id,
      session.id,
      action.id,
      user.id,
      'não autorizado neste horário',
    );

    expect(denied.status).toBe('denied');
    expect(denied.decidedBy).toBe(user.id);
    expect(denied.rejectionReason).toBe('não autorizado neste horário');
  });

  it('rejeita decidir uma ação já decidida', async () => {
    const { user, project, session, action } = await setupPendingAction();
    await denyAction.execute(project.id, session.id, action.id, user.id);

    await expect(
      denyAction.execute(project.id, session.id, action.id, user.id),
    ).rejects.toThrow(InvalidActionTransitionError);
  });
});
