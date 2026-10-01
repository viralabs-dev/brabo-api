import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
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
import { DrizzleContainerRepository } from '../../../../src/infrastructure/persistence/drizzle/container.repository';
import { FsPermissionsFileStore } from '../../../../src/infrastructure/filesystem/fs-permissions-file-store';
import { ResolveEffectiveRoleUseCase } from '../../../../src/application/use-cases/iam/resolve-effective-role.use-case';
import { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import { ExecuteTerminalActionUseCase } from '../../../../src/application/use-cases/actions/execute-terminal-action.use-case';
import { ObterCicloDeVidaDoContainerUseCase } from '../../../../src/application/use-cases/containers/obter-ciclo-de-vida-do-container.use-case';
import { ProposeActionUseCase } from '../../../../src/application/use-cases/actions/propose-action.use-case';
import { ApproveActionUseCase } from '../../../../src/application/use-cases/actions/approve-action.use-case';
import {
  ACAO_JA_RECUSADA,
  ApproveAlwaysActionUseCase,
} from '../../../../src/application/use-cases/actions/approve-always-action.use-case';
import { DenyActionUseCase } from '../../../../src/application/use-cases/actions/deny-action.use-case';
import { InvalidActionTransitionError } from '../../../../src/domain/actions/action-state-machine';
import type { PermissionsFileStore } from '../../../../src/application/ports/permissions-file-store.port';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import type { TerminalExecutionResult } from '../../../../src/domain/actions/terminal-execution-result';
import { BraboMetrics } from '../../../../src/infrastructure/observability/brabo-metrics';
import { AGENT_AUTONOMY_ALL_ACTIONS } from '../../../../src/domain/actions/decide';

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
  executeGitAction(): Promise<Record<string, unknown>> {
    return Promise.resolve({});
  }
  async acceptParallelization(): Promise<void> {}
  async rearmDevAgent(): Promise<void> {}
  async reviseStory(): Promise<void> {}
  async offerInfraHandoff(): Promise<void> {}
  async reanalyzeSession(): Promise<void> {}
  getPsychologistStatus(): Promise<{ enabled: boolean }> {
    return Promise.resolve({ enabled: true });
  }
  async runAnamnese(): Promise<void> {}
  async invalidateInstructions(): Promise<void> {}
  requestRunnerTicket(): Promise<{ ticket: string; expiresAt: Date }> {
    return Promise.resolve({ ticket: 'fake-ticket', expiresAt: new Date() });
  }
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
  undefined as never, // executeContainerStart — não exercitado aqui
  undefined as never, // executeContainerStartViaRunner — não exercitado aqui
  undefined as never, // executeContainerStop — não exercitado aqui
  appendSessionEvent,
  obterCicloDeVidaDoContainer,
  { configurado: () => true } as never, // brokerPort
  undefined as never, // executeExecutionPlan — não exercitado aqui
);
const approveAction = new ApproveActionUseCase(
  unitOfWork,
  sessionRepo,
  proposedActionRepo,
  outboxRepo,
  executeTerminalAction,
  undefined as never, // executeAdrPr
  undefined as never, // executeInfraPr
  undefined as never, // executeContainerStart
  undefined as never, // executeContainerStartViaRunner
  undefined as never, // executeContainerStop
  undefined as never, // executeContainerRemove
  {
    execute: (_p: string, _s: string, a: unknown) => Promise.resolve(a),
  } as unknown as never, // executeGitAction: passthrough
  undefined as never, // executeParallelization — não exercitado aqui
  undefined as never, // executeMaxParallelRaise — não exercitado aqui
  undefined as never, // executeInstructionPatch — não exercitado aqui,
  new BraboMetrics(),
  appendSessionEvent,
  undefined as never, // executeExecutionPlan — não exercitado aqui
);
const approveAlwaysAction = new ApproveAlwaysActionUseCase(
  proposedActionRepo,
  projectRepo,
  permissionsFileStore,
  appendSessionEvent,
  approveAction,
  agentAutonomyRepo,
  unitOfWork,
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

// `qa-automacao` — de propósito NÃO prefixado por `dev-`: este é o fixture
// default dos testes do caminho ANTIGO (permissions.json), e um agentId que
// `ehDevDeModulo` classificasse como módulo mudaria o destino da gravação
// por acidente de nome, não por intenção do teste.
async function setupPendingTerminalAction(
  command = 'echo oi',
  actorId = 'qa-automacao',
) {
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
    actor: { kind: 'agent', id: actorId },
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

    const file = await permissionsFileStore.read(project);
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

  // A OUTRA metade do teto absoluto de decide.ts (RN-106): sem isto, um
  // clique aqui gravaria `Terminal(git push)`/`Terminal(sudo)` em
  // permissions.json/allow e reabriria pra sempre a porta que o teto de
  // decide() existe pra manter fechada.
  it('"sempre permitir" sobre `git push` recusa gravar padrão e NÃO aprova a ação', async () => {
    const { project, session, user, action } = await setupPendingTerminalAction(
      'git push origin main',
    );
    expect(action.status).toBe('pending');

    await expect(
      approveAlwaysAction.execute(project.id, session.id, action.id, user.id),
    ).rejects.toThrow(BadRequestException);

    const file = await permissionsFileStore.read(project);
    expect(file.allow).toEqual([]);

    // A ação instância continua pendente — não foi aprovada por este
    // caminho. O usuário aprova ela pelo fluxo normal (approve simples).
    const stillPending = await proposedActionRepo.findInSessionForUpdate(
      session.id,
      action.id,
    );
    expect(stillPending?.status).toBe('pending');
  });

  it('"sempre permitir" sobre comando privilegiado (`sudo`) recusa gravar padrão e NÃO aprova a ação', async () => {
    const { project, session, user, action } = await setupPendingTerminalAction(
      'sudo apt install htop',
    );
    expect(action.status).toBe('pending');

    await expect(
      approveAlwaysAction.execute(project.id, session.id, action.id, user.id),
    ).rejects.toThrow(BadRequestException);

    const file = await permissionsFileStore.read(project);
    expect(file.allow).toEqual([]);
  });

  it('regressão: "sempre permitir" sobre comando comum (sem efeito externo, sem sudo) continua gravando o padrão normalmente', async () => {
    const { project, session, user, action } =
      await setupPendingTerminalAction('pnpm test');

    const approved = await approveAlwaysAction.execute(
      project.id,
      session.id,
      action.id,
      user.id,
    );

    expect(approved.status).toBe('executed');
    const file = await permissionsFileStore.read(project);
    expect(file.allow).toEqual(['Terminal(pnpm test)']);
  });

  // RN-507 (Frente 2): "sempre permitir" de um dev-de-módulo escopa a
  // `agent_autonomy`, POR AGENTE — não mais pro permissions.json de
  // projeto inteiro.
  describe('escopo por Dev Agent de módulo (RN-507)', () => {
    it('caminho feliz: dev-checkout ganha agent_autonomy(projeto, dev-checkout, terminal)=auto_approve; permissions.json fica INTOCADO; dev-auth continua exigindo aprovação pra ação idêntica', async () => {
      const { project, session, user, action } =
        await setupPendingTerminalAction('echo oi', 'dev-checkout');

      const approved = await approveAlwaysAction.execute(
        project.id,
        session.id,
        action.id,
        user.id,
      );

      expect(approved.status).toBe('executed');

      const mode = await agentAutonomyRepo.findMode(
        project.id,
        'dev-checkout',
        'terminal',
      );
      expect(mode).toBe('auto_approve');

      const file = await permissionsFileStore.read(project);
      expect(file.allow).toEqual([]);

      // A mesma ação, do PONTO DE VISTA de outro agente de módulo — prova
      // que a chave é (projeto, AGENTE, tipo), nunca (projeto, tipo).
      const fromOtherAgent = await proposeAction.execute(
        project.id,
        session.id,
        {
          actionType: 'terminal',
          actor: { kind: 'agent', id: 'dev-auth' },
          payload: { command: 'echo oi' },
        },
      );
      expect(fromOtherAgent.status).toBe('pending');
    });

    it('não-regressão dos tetos absolutos: dev-checkout em `git push` continua recusando o clique inteiro, sem gravar nada em agent_autonomy', async () => {
      const { project, session, user, action } =
        await setupPendingTerminalAction(
          'git push origin main',
          'dev-checkout',
        );

      await expect(
        approveAlwaysAction.execute(project.id, session.id, action.id, user.id),
      ).rejects.toThrow(BadRequestException);

      const mode = await agentAutonomyRepo.findMode(
        project.id,
        'dev-checkout',
        'terminal',
      );
      expect(mode).toBeNull();
      const file = await permissionsFileStore.read(project);
      expect(file.allow).toEqual([]);
    });

    it('não-regressão dos tetos absolutos: dev-checkout em `sudo` continua recusando o clique inteiro', async () => {
      const { project, session, user, action } =
        await setupPendingTerminalAction(
          'sudo apt install htop',
          'dev-checkout',
        );

      await expect(
        approveAlwaysAction.execute(project.id, session.id, action.id, user.id),
      ).rejects.toThrow(BadRequestException);

      const mode = await agentAutonomyRepo.findMode(
        project.id,
        'dev-checkout',
        'terminal',
      );
      expect(mode).toBeNull();
    });

    it('não-regressão dos tetos absolutos: dev-checkout em `container_remove` continua recusando o clique inteiro', async () => {
      const { user, project, session } = await setupPendingTerminalAction();
      const removal = await proposeAction.execute(project.id, session.id, {
        actionType: 'container_remove',
        actor: { kind: 'agent', id: 'dev-checkout' },
        payload: {},
      });
      expect(removal.status).toBe('pending');

      await expect(
        approveAlwaysAction.execute(
          project.id,
          session.id,
          removal.id,
          user.id,
        ),
      ).rejects.toThrow(BadRequestException);

      const mode = await agentAutonomyRepo.findMode(
        project.id,
        'dev-checkout',
        'container_remove',
      );
      expect(mode).toBeNull();
    });

    it('caso do achado: ator `dev-lead` (não é dev-de-módulo — lidera a área, não é membro dela) continua indo pro permissions.json', async () => {
      const { project, session, user, action } =
        await setupPendingTerminalAction('echo oi', 'dev-lead');

      const approved = await approveAlwaysAction.execute(
        project.id,
        session.id,
        action.id,
        user.id,
      );

      expect(approved.status).toBe('executed');
      const file = await permissionsFileStore.read(project);
      expect(file.allow).toEqual(['Terminal(echo oi)']);

      const mode = await agentAutonomyRepo.findMode(
        project.id,
        'dev-lead',
        'terminal',
      );
      expect(mode).toBeNull();
    });

    it('não-regressão do caminho antigo: ator `user` (não `agent`) continua indo pro permissions.json, mesmo com um id que começa com "dev-"', async () => {
      const { project, session, user } = await setupPendingTerminalAction();
      // `current.actor.kind === 'agent'` é a PRIMEIRA guarda do branch — um
      // ator `user` cujo id por acidente começasse com `dev-` não pode
      // escapar pro caminho de `agent_autonomy`.
      const action = await proposeAction.execute(project.id, session.id, {
        actionType: 'terminal',
        actor: { kind: 'user', id: 'dev-checkout' },
        payload: { command: 'echo oi' },
      });
      expect(action.actor.kind).toBe('user');

      const approved = await approveAlwaysAction.execute(
        project.id,
        session.id,
        action.id,
        user.id,
      );

      expect(approved.status).toBe('executed');
      const file = await permissionsFileStore.read(project);
      expect(file.allow).toEqual(['Terminal(echo oi)']);

      const mode = await agentAutonomyRepo.findMode(
        project.id,
        'dev-checkout',
        'terminal',
      );
      expect(mode).toBeNull();
    });
  });

  // RN-642 (AT-310): uso real de 29/09 — 173 cliques em "Sempre permitir", 45
  // devolvendo 409. O padrão era gravado ANTES de aprovar: ação que já tinha
  // saído de `pending` lançava 409 com o padrão gravado e SEM o evento.
  describe('ordem e idempotência (RN-642)', () => {
    async function eventosDaSessao(sessionId: string) {
      const pagina = await sessionEventRepo.listPaginated(sessionId, {
        limit: 200,
      });
      return pagina.items;
    }

    function novoDeny() {
      return new DenyActionUseCase(
        unitOfWork,
        sessionRepo,
        proposedActionRepo,
        outboxRepo,
        new BraboMetrics(),
        appendSessionEvent,
        undefined, // executeExecutionPlan — não exercitado aqui
      );
    }

    it('caminho feliz: nomeia o desfecho `aprovada`, e o permission.granted vem DEPOIS do proposed_action.approved', async () => {
      const { user, project, session, action } =
        await setupPendingTerminalAction('echo oi');

      const r = await approveAlwaysAction.execute(
        project.id,
        session.id,
        action.id,
        user.id,
      );

      expect(r.desfecho).toBe('aprovada');
      expect(r.padraoGravado).toBe(true);
      const tipos = (await eventosDaSessao(session.id)).map((e) => e.type);
      const aprovou = tipos.indexOf('proposed_action.approved');
      const concedeu = tipos.indexOf('permission.granted');
      expect(aprovou).toBeGreaterThanOrEqual(0);
      expect(concedeu).toBeGreaterThan(aprovou);
    });

    it('clique duplo: o segundo clique é sucesso `ja_aprovada`, sem executar de novo, sem regravar e sem segundo permission.granted', async () => {
      const { user, project, session, action } =
        await setupPendingTerminalAction('echo oi');
      await approveAlwaysAction.execute(
        project.id,
        session.id,
        action.id,
        user.id,
      );

      const segundo = await approveAlwaysAction.execute(
        project.id,
        session.id,
        action.id,
        user.id,
      );

      expect(segundo.desfecho).toBe('ja_aprovada');
      expect(segundo.padraoGravado).toBe(false);
      expect(segundo.status).toBe('executed');
      expect(fakeEngineClient.callCount).toBe(1);
      const file = await permissionsFileStore.read(project);
      expect(file.allow).toEqual(['Terminal(echo oi)']);
      const concessoes = (await eventosDaSessao(session.id)).filter(
        (e) => e.type === 'permission.granted',
      );
      expect(concessoes).toHaveLength(1);
    });

    it('cliques CONCORRENTES na mesma ação: um aprova, o outro é `ja_aprovada` — nenhum 409, uma execução, um evento', async () => {
      const { user, project, session, action } =
        await setupPendingTerminalAction('echo oi');

      const resultados = await Promise.all([
        approveAlwaysAction.execute(project.id, session.id, action.id, user.id),
        approveAlwaysAction.execute(project.id, session.id, action.id, user.id),
      ]);

      expect(resultados.map((r) => r.desfecho).sort()).toEqual([
        'aprovada',
        'ja_aprovada',
      ]);
      expect(fakeEngineClient.callCount).toBe(1);
      const concessoes = (await eventosDaSessao(session.id)).filter(
        (e) => e.type === 'permission.granted',
      );
      expect(concessoes).toHaveLength(1);
    });

    it('ação aprovada por OUTRO caminho (approve simples): "sempre" é `ja_aprovada` e grava o padrão que faltava, COM o evento', async () => {
      const { user, project, session, action } =
        await setupPendingTerminalAction('echo oi');
      await approveAction.execute(project.id, session.id, action.id, user.id);

      const r = await approveAlwaysAction.execute(
        project.id,
        session.id,
        action.id,
        user.id,
      );

      expect(r.desfecho).toBe('ja_aprovada');
      expect(r.padraoGravado).toBe(true);
      expect(fakeEngineClient.callCount).toBe(1);
      const file = await permissionsFileStore.read(project);
      expect(file.allow).toEqual(['Terminal(echo oi)']);
      const concessoes = (await eventosDaSessao(session.id)).filter(
        (e) => e.type === 'permission.granted',
      );
      expect(concessoes).toEqual([
        expect.objectContaining({
          payload: {
            pattern: 'Terminal(echo oi)',
            patterns: ['Terminal(echo oi)'],
          },
        }),
      ]);
    });

    it('falha: ação RECUSADA continua 409 NOMEADO (`acao_ja_recusada`) e NENHUM padrão é gravado — nem arquivo, nem evento', async () => {
      const { user, project, session, action } =
        await setupPendingTerminalAction('echo oi');
      await novoDeny().execute(project.id, session.id, action.id, user.id);

      const erro: unknown = await approveAlwaysAction
        .execute(project.id, session.id, action.id, user.id)
        .catch((e: unknown) => e);

      expect(erro).toBeInstanceOf(ConflictException);
      expect((erro as ConflictException).getResponse()).toMatchObject({
        reason: ACAO_JA_RECUSADA,
        status: 'denied',
      });
      const file = await permissionsFileStore.read(project);
      expect(file.allow).toEqual([]);
      const concessoes = (await eventosDaSessao(session.id)).filter(
        (e) => e.type === 'permission.granted',
      );
      expect(concessoes).toHaveLength(0);
    });

    it('falha: ação de dev-de-módulo RECUSADA não grava agent_autonomy', async () => {
      const { user, project, session, action } =
        await setupPendingTerminalAction('echo oi', 'dev-checkout');
      await novoDeny().execute(project.id, session.id, action.id, user.id);

      await expect(
        approveAlwaysAction.execute(project.id, session.id, action.id, user.id),
      ).rejects.toThrow(ConflictException);

      expect(
        await agentAutonomyRepo.findMode(
          project.id,
          'dev-checkout',
          'terminal',
        ),
      ).toBeNull();
    });

    it('dev-de-módulo, clique duplo: `ja_aprovada` sem segundo permission.granted', async () => {
      const { user, project, session, action } =
        await setupPendingTerminalAction('echo oi', 'dev-checkout');
      await approveAlwaysAction.execute(
        project.id,
        session.id,
        action.id,
        user.id,
      );

      const segundo = await approveAlwaysAction.execute(
        project.id,
        session.id,
        action.id,
        user.id,
      );

      expect(segundo).toMatchObject({
        desfecho: 'ja_aprovada',
        padraoGravado: false,
      });
      const concessoes = (await eventosDaSessao(session.id)).filter(
        (e) => e.type === 'permission.granted',
      );
      expect(concessoes).toEqual([
        expect.objectContaining({
          payload: { agentId: 'dev-checkout', actionType: 'terminal' },
        }),
      ]);
    });

    it('falha: o padrão que não grava DESFAZ a aprovação (mesma transação) — a ação segue pending, nada executa, nenhum evento', async () => {
      const { user, project, session, action } =
        await setupPendingTerminalAction('echo oi');
      const arquivoQueFalha = {
        read: (local: Parameters<PermissionsFileStore['read']>[0]) =>
          permissionsFileStore.read(local),
        addPattern: () => Promise.reject(new Error('disco cheio')),
      } as unknown as PermissionsFileStore;
      const comArquivoQueFalha = new ApproveAlwaysActionUseCase(
        proposedActionRepo,
        projectRepo,
        arquivoQueFalha,
        appendSessionEvent,
        approveAction,
        agentAutonomyRepo,
        unitOfWork,
      );

      await expect(
        comArquivoQueFalha.execute(project.id, session.id, action.id, user.id),
      ).rejects.toThrow('disco cheio');

      const depois = await proposedActionRepo.findInSessionForUpdate(
        session.id,
        action.id,
      );
      expect(depois?.status).toBe('pending');
      expect(fakeEngineClient.callCount).toBe(0);
      const tipos = (await eventosDaSessao(session.id)).map((e) => e.type);
      expect(tipos).not.toContain('proposed_action.approved');
      expect(tipos).not.toContain('permission.granted');
    });

    it('transição inválida vinda da EXECUÇÃO (depois da decisão) não vira `ja_aprovada`: propaga', async () => {
      const { user, project, session, action } =
        await setupPendingTerminalAction('echo oi');
      const aprovacaoQueQuebraNaExecucao = {
        execute: async (
          _p: string,
          _s: string,
          _a: string,
          _d: string,
          aoAprovar?: (acao: unknown) => Promise<void>,
        ) => {
          await unitOfWork.runInTransaction(async () => {
            if (aoAprovar) await aoAprovar(action);
          });
          throw new InvalidActionTransitionError('executed', 'executed');
        },
      } as unknown as ApproveActionUseCase;
      const caso = new ApproveAlwaysActionUseCase(
        proposedActionRepo,
        projectRepo,
        permissionsFileStore,
        appendSessionEvent,
        aprovacaoQueQuebraNaExecucao,
        agentAutonomyRepo,
        unitOfWork,
      );

      await expect(
        caso.execute(project.id, session.id, action.id, user.id),
      ).rejects.toThrow(InvalidActionTransitionError);
    });

    it('tetos intactos (RN-418): `git push` e `doas` continuam 400 mesmo com a ação já aprovada — nunca viram `ja_aprovada` com padrão gravado', async () => {
      for (const comando of ['git push origin main', 'doas reboot']) {
        await truncateAll(db);
        const { user, project, session, action } =
          await setupPendingTerminalAction(comando);
        await approveAction.execute(project.id, session.id, action.id, user.id);

        await expect(
          approveAlwaysAction.execute(
            project.id,
            session.id,
            action.id,
            user.id,
          ),
        ).rejects.toThrow(BadRequestException);
        const file = await permissionsFileStore.read(project);
        expect(file.allow).toEqual([]);
      }
    });
  });

  // AT-320: a auditoria visual de 30/09 viu "Sempre permitir" oferecido para
  // `git_push`. MEDIDO: a api só recusava o `git push` DIGITADO no terminal; o
  // `git_push` TIPADO passava e gravava `GitPush()` em `allow` (ou autonomia
  // do módulo). A lista única `TIPOS_SEM_SEMPRE_PERMITIR` fecha os dois.
  describe('tipos do teto (AT-320)', () => {
    it.each([
      ['git_push', 'qa-automacao', {}],
      ['pr_open', 'qa-automacao', {}],
      ['git_merge', 'qa-automacao', { targetBranch: 'dev' }],
      ['instruction_patch', 'qa-automacao', {}],
      ['git_push', 'dev-checkout', {}],
    ] as const)(
      '`%s` de `%s`: 400 nomeado (`teto_do_sempre_permitir`), sem padrão, sem autonomia, a ação segue pending',
      async (actionType, actorId, payload) => {
        const { user, project, session } = await setupPendingTerminalAction();
        const acao = await proposeAction.execute(project.id, session.id, {
          actionType,
          actor: { kind: 'agent', id: actorId },
          payload,
        });
        expect(acao.status).toBe('pending');

        const erro: unknown = await approveAlwaysAction
          .execute(project.id, session.id, acao.id, user.id)
          .catch((e: unknown) => e);

        expect(erro).toBeInstanceOf(BadRequestException);
        expect((erro as BadRequestException).getResponse()).toMatchObject({
          reason: 'teto_do_sempre_permitir',
          actionType,
        });
        const file = await permissionsFileStore.read(project);
        expect(file.allow).toEqual([]);
        expect(
          await agentAutonomyRepo.findMode(project.id, actorId, actionType),
        ).toBeNull();
        const depois = await proposedActionRepo.findInSessionForUpdate(
          session.id,
          acao.id,
        );
        expect(depois?.status).toBe('pending');
      },
    );

    it('regressão: tipo fora do teto (`git_commit`) continua gravando o padrão', async () => {
      const { user, project, session } = await setupPendingTerminalAction();
      const acao = await proposeAction.execute(project.id, session.id, {
        actionType: 'git_commit',
        actor: { kind: 'agent', id: 'qa-automacao' },
        payload: {},
      });

      const r = await approveAlwaysAction.execute(
        project.id,
        session.id,
        acao.id,
        user.id,
      );

      expect(r.desfecho).toBe('aprovada');
      const file = await permissionsFileStore.read(project);
      expect(file.allow).toEqual(['GitCommit()']);
    });
  });
});

/**
 * AT-255 (RN-670, ADR 0189) — o cenário MEDIDO no uso real de 29/09, como
 * teste de não-regressão: o modo automático ligado (curinga `*:
 * auto_approve`) e, depois, "Sempre permitir" num dev agent. O clique grava
 * `terminal: auto_approve` para o agente (RN-509) e, até aqui, essa linha
 * SOMBREAVA a curinga: o repositório a devolvia com origem `especifica`, e o
 * composto sintetizado e o escopo voltavam a pedir aprovação — 97 + 37
 * pedidos no uso real, com o piloto "ligado" na tela.
 */
describe('ApproveAlwaysActionUseCase — "Sempre permitir" não desliga o piloto (RN-670)', () => {
  it('curinga ligada + sempre permitir: composto sem regra e caminho fora da pasta seguem sem pedido de aprovação', async () => {
    // A pendência nasce ANTES de a curinga ser ligada — é como ela existia no
    // uso real (o clique foi sobre o que tinha ficado na fila).
    const { project, session, user, action } = await setupPendingTerminalAction(
      'cd /work && npm test',
      'dev-api',
    );
    expect(action.status).toBe('pending');

    await agentAutonomyRepo.upsert(
      project.id,
      'dev-api',
      AGENT_AUTONOMY_ALL_ACTIONS,
      'auto_approve',
    );
    await approveAlwaysAction.execute(
      project.id,
      session.id,
      action.id,
      user.id,
    );

    // O clique continua gravando a específica — ela é o que fica valendo se
    // o toggle voltar para manual.
    const linhas = await agentAutonomyRepo.listForProject(project.id);
    expect(linhas).toContainEqual({
      agentId: 'dev-api',
      actionType: 'terminal',
      mode: 'auto_approve',
    });

    const depois = await proposeAction.execute(project.id, session.id, {
      actionType: 'terminal',
      actor: { kind: 'agent', id: 'dev-api' },
      payload: { command: 'cd /work && npm test > /tmp/saida.txt' },
    });
    expect(depois.resolvedPolicy).toBe('auto_approve');
    expect(depois.status).toBe('executed');
  });

  it('caso de falha: com o toggle de volta em manual, a específica gravada pelo clique segue com o escopo', async () => {
    const { project, session, user, action } = await setupPendingTerminalAction(
      'cd /work && npm test',
      'dev-api',
    );
    await agentAutonomyRepo.upsert(
      project.id,
      'dev-api',
      AGENT_AUTONOMY_ALL_ACTIONS,
      'auto_approve',
    );
    await approveAlwaysAction.execute(
      project.id,
      session.id,
      action.id,
      user.id,
    );
    await agentAutonomyRepo.upsert(
      project.id,
      'dev-api',
      AGENT_AUTONOMY_ALL_ACTIONS,
      'require_approval',
    );

    const depois = await proposeAction.execute(project.id, session.id, {
      actionType: 'terminal',
      actor: { kind: 'agent', id: 'dev-api' },
      payload: { command: 'cat /etc/passwd' },
    });
    expect(depois.resolvedPolicy).toBe('require_approval');
    expect(depois.status).toBe('pending');
  });
});

/**
 * AT-257 (RN-675): "Sempre permitir" grava VERBO + SUBCOMANDO, um padrão por
 * segmento. Antes gravava o comando inteiro, byte a byte — 173 cliques no uso
 * real de 29/09, porque o próximo comando nunca era igual — e o composto virava
 * UM padrão que só casava o primeiro segmento.
 */
describe('ApproveAlwaysActionUseCase — a unidade do padrão é verbo + subcomando (RN-675)', () => {
  it('o clique num composto libera o PRÓXIMO composto com os mesmos verbos e subcomandos', async () => {
    const { project, session, user, action } = await setupPendingTerminalAction(
      'cd src/app && npm test',
    );
    await approveAlwaysAction.execute(
      project.id,
      session.id,
      action.id,
      user.id,
    );

    const file = await permissionsFileStore.read(project);
    expect(file.allow).toEqual(['Terminal(cd)', 'Terminal(npm test)']);

    const depois = await proposeAction.execute(project.id, session.id, {
      actionType: 'terminal',
      actor: { kind: 'agent', id: 'qa-automacao' },
      payload: { command: 'cd lib/core && npm test -- --coverage' },
    });
    expect(depois.resolvedPolicy).toBe('auto_approve');
  });

  it('caso de falha: outro subcomando do mesmo verbo continua pedindo', async () => {
    const { project, session, user, action } =
      await setupPendingTerminalAction('npm test');
    await approveAlwaysAction.execute(
      project.id,
      session.id,
      action.id,
      user.id,
    );

    const depois = await proposeAction.execute(project.id, session.id, {
      actionType: 'terminal',
      actor: { kind: 'agent', id: 'qa-automacao' },
      payload: { command: 'npm install left-pad' },
    });
    expect(depois.resolvedPolicy).toBe('require_approval');
  });

  it('o teto da RN-418 segue recusando o clique inteiro num composto que empurra', async () => {
    const { project, session, user, action } = await setupPendingTerminalAction(
      'npm test && git push origin dev',
    );
    await expect(
      approveAlwaysAction.execute(project.id, session.id, action.id, user.id),
    ).rejects.toThrow(BadRequestException);
    const file = await permissionsFileStore.read(project);
    expect(file.allow).toEqual([]);
  });
});
