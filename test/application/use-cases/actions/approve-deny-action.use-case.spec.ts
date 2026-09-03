import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotFoundException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { eq } from 'drizzle-orm';
import {
  outboxEvents,
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
import { DrizzleContainerRepository } from '../../../../src/infrastructure/persistence/drizzle/container.repository';
import { FsPermissionsFileStore } from '../../../../src/infrastructure/filesystem/fs-permissions-file-store';
import { ResolveEffectiveRoleUseCase } from '../../../../src/application/use-cases/iam/resolve-effective-role.use-case';
import { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import { ExecuteTerminalActionUseCase } from '../../../../src/application/use-cases/actions/execute-terminal-action.use-case';
import { ObterCicloDeVidaDoContainerUseCase } from '../../../../src/application/use-cases/containers/obter-ciclo-de-vida-do-container.use-case';
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
const containerRepo = new DrizzleContainerRepository(db);
const obterCicloDeVidaDoContainer = new ObterCicloDeVidaDoContainerUseCase(
  containerRepo,
);
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
  async getPsychologistStatus(): Promise<{ enabled: boolean }> {
    return { enabled: true };
  }
  async runAnamnese(): Promise<void> {}
  async invalidateInstructions(): Promise<void> {}
  async requestRunnerTicket(): Promise<{ ticket: string; expiresAt: Date }> {
    return { ticket: 'fake-ticket', expiresAt: new Date() };
  }
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
  undefined as never, // executeContainerStart — não exercitado aqui
  appendSessionEvent,
  obterCicloDeVidaDoContainer,
);
const approveAction = new ApproveActionUseCase(
  unitOfWork,
  sessionRepo,
  proposedActionRepo,
  outboxRepo,
  executeTerminalAction,
  undefined as never, // executeAdrPr — não exercitado aqui
  undefined as never, // executeInfraPr — não exercitado aqui
  undefined as never, // executeContainerStart — não exercitado aqui
  // executeGitAction: passthrough (o executor git de verdade é testado à parte).
  {
    execute: (_p: string, _s: string, a: unknown) => Promise.resolve(a),
  } as unknown as never,
  undefined as never, // executeParallelization — não exercitado aqui
  undefined as never, // executeMaxParallelRaise — não exercitado aqui
  undefined as never, // executeInstructionPatch — não exercitado aqui,
  new BraboMetrics(),
  appendSessionEvent,
);
const denyAction = new DenyActionUseCase(
  unitOfWork,
  sessionRepo,
  proposedActionRepo,
  outboxRepo,
  new BraboMetrics(),
  appendSessionEvent,
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

/** Os eventos da sessão, em ordem, como a linha do tempo os mostra. */
async function eventosDa(sessionId: string) {
  const page = await sessionEventRepo.listPaginated(sessionId, { limit: 200 });
  return page.items;
}

describe('a decisão no event log (achado #17 do dogfooding)', () => {
  it('propor grava `proposed_action.created` com o AGENTE e o status resolvido', async () => {
    const { session } = await setupPendingAction();

    const criado = (await eventosDa(session.id)).find(
      (e) => e.type === 'proposed_action.created',
    );

    expect(criado).toBeTruthy();
    expect(criado!.actor).toEqual({ kind: 'agent', id: 'dev-agent' });
    // `status` é o que torna a auto-aprovação distinguível de um clique.
    expect(criado!.payload).toMatchObject({
      actionType: 'git_push',
      status: 'pending',
    });
  });

  it('aprovar grava `proposed_action.approved` com o USUÁRIO que clicou', async () => {
    // A métrica que a Fase 10 quis medir e não conseguiu: cliques de
    // aprovação. Antes disto, a decisão só existia no outbox (transporte,
    // podado) e em `proposed_actions.decided_at` (fora da linha do tempo).
    const { user, project, session, action } = await setupPendingAction();

    await approveAction.execute(project.id, session.id, action.id, user.id);

    const aprovado = (await eventosDa(session.id)).find(
      (e) => e.type === 'proposed_action.approved',
    );

    expect(aprovado).toBeTruthy();
    expect(aprovado!.actor).toEqual({ kind: 'user', id: user.id });
    expect(aprovado!.payload).toMatchObject({
      actionId: action.id,
      actionType: 'git_push',
      from: 'pending',
    });
  });

  it('negar grava `proposed_action.denied` com o usuário e o motivo', async () => {
    const { user, project, session, action } = await setupPendingAction();

    await denyAction.execute(
      project.id,
      session.id,
      action.id,
      user.id,
      'push direto em branch protegida',
    );

    const negado = (await eventosDa(session.id)).find(
      (e) => e.type === 'proposed_action.denied',
    );

    expect(negado!.actor).toEqual({ kind: 'user', id: user.id });
    expect(negado!.payload).toMatchObject({
      reason: 'push direto em branch protegida',
    });
  });

  it('auto-aprovação NÃO produz evento de aprovação — só o created com o status', async () => {
    // O corte que dá a métrica: contar `proposed_action.approved` conta
    // decisão HUMANA. A política decidindo sozinha aparece no `created`, com
    // ator agente, e nunca é confundida com um clique.
    const { user, project, session } = await setupPendingAction();
    // `write_file` porque auto-aprovar não dispara executor nenhum no propose
    // — o que está sob teste é o EVENTO, não a execução.
    await agentAutonomyRepo.upsert(
      project.id,
      'dev-agent',
      'write_file',
      'auto_approve',
    );

    await proposeAction.execute(project.id, session.id, {
      actionType: 'write_file',
      actor: { kind: 'agent', id: 'dev-agent' },
      payload: { path: 'x.md', content: 'x' },
    });

    const eventos = await eventosDa(session.id);
    const auto = eventos.filter(
      (e) =>
        e.type === 'proposed_action.created' &&
        (e.payload as { status?: string }).status === 'auto_approved',
    );
    const cliques = eventos.filter(
      (e) => e.type === 'proposed_action.approved',
    );

    expect(auto).toHaveLength(1);
    expect(auto[0].actor.kind).toBe('agent');
    expect(cliques).toHaveLength(0);
    expect(user).toBeTruthy();
  });
});

/**
 * O evento que solta o agente parado (ADR 0052) — e o agregado em que ele
 * NASCE, que é a metade do contrato que mora deste lado.
 *
 * A regressão: emitido com `aggregateType: 'proposed_action'`, o evento é
 * gravado com sucesso e o dreno do engine nunca o lê — o `where` de
 * `Engine.Outbox.Drain` só aceita `session` e `task`. Nada falha aqui, nada
 * falha lá, e o agente fica em `awaiting_approval` para sempre. A outra metade
 * está em apps/engine/test/engine/outbox/drain_test.exs; nenhum dos dois lados
 * sozinho pega a divergência.
 */
describe('task.action_settled: o agregado que o engine consegue ler', () => {
  async function settledDe(sessionId: string) {
    const rows = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, 'task.action_settled'));
    return rows.filter(
      (r) => (r.payload as { sessionId?: string }).sessionId === sessionId,
    );
  }

  it('aprovar emite no agregado `task`, com o resultado pro agente', async () => {
    const { user, project, session, action } = await setupPendingAction();

    await approveAction.execute(project.id, session.id, action.id, user.id);

    const [evento] = await settledDe(session.id);
    expect(evento).toBeTruthy();
    // O assert que teria evitado a execução perdida.
    expect(evento.aggregateType).toBe('task');
    expect(evento.aggregateId).toBe(action.id);
    expect(evento.payload).toMatchObject({
      projectId: project.id,
      actionId: action.id,
      agentId: 'dev-agent',
    });
  });

  it('negar emite no agregado `task`, com o motivo — recusa é resposta', async () => {
    const { user, project, session, action } = await setupPendingAction();

    await denyAction.execute(
      project.id,
      session.id,
      action.id,
      user.id,
      'esse comando não',
    );

    const [evento] = await settledDe(session.id);
    expect(evento).toBeTruthy();
    expect(evento.aggregateType).toBe('task');
    expect(evento.payload).toMatchObject({
      actionId: action.id,
      agentId: 'dev-agent',
      status: 'denied',
      rejectionReason: 'esse comando não',
    });
  });
});

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
