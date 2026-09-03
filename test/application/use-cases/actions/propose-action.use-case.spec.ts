import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotFoundException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  projects,
  projectContainers,
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
import { DrizzleContainerRepository } from '../../../../src/infrastructure/persistence/drizzle/container.repository';
import { FsPermissionsFileStore } from '../../../../src/infrastructure/filesystem/fs-permissions-file-store';
import { ResolveEffectiveRoleUseCase } from '../../../../src/application/use-cases/iam/resolve-effective-role.use-case';
import { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import { ExecuteTerminalActionUseCase } from '../../../../src/application/use-cases/actions/execute-terminal-action.use-case';
import { ObterCicloDeVidaDoContainerUseCase } from '../../../../src/application/use-cases/containers/obter-ciclo-de-vida-do-container.use-case';
import { ProposeActionUseCase } from '../../../../src/application/use-cases/actions/propose-action.use-case';
import { RECURSOS_PADRAO } from '../../../../src/domain/containers/project-container';
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
  undefined as never, // executeContainerStart — não exercitado aqui
  undefined as never, // executeContainerStop — não exercitado aqui
  appendSessionEvent,
  obterCicloDeVidaDoContainer,
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

async function marcarContainerRunning(projectId: string) {
  await db.insert(projectContainers).values({
    projectId,
    status: 'running',
    imageVersion: 1,
    containerId: 'container-1',
    cpus: RECURSOS_PADRAO.cpus,
    memoryMb: RECURSOS_PADRAO.memoryMb,
    pidsLimit: RECURSOS_PADRAO.pidsLimit,
  });
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
    await permissionsFileStore.write(project, {
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
    await permissionsFileStore.write(project, {
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

  it('auto mode (agent_autonomy "*") auto-aprova ação comum SEM bater em permissions.json (RN-153)', async () => {
    const { project, session } = await setupSession();
    await agentAutonomyRepo.upsert(project.id, 'dev-api', '*', 'auto_approve');
    // permissions.json fica vazio de propósito — se a auto-aprovação
    // dependesse dele, esta ação cairia em pending.

    const action = await proposeAction.execute(project.id, session.id, {
      actionType: 'terminal',
      actor: { kind: 'agent', id: 'dev-api' },
      payload: { command: 'echo oi' },
    });

    expect(action.resolvedPolicy).toBe('auto_approve');
    expect(action.status).toBe('executed');
    expect(fakeEngineClient.calls).toEqual([
      { actionId: action.id, command: 'echo oi' },
    ]);
  });

  it('auto mode NÃO auto-aprova merge em branch protegida — teto absoluto (RN-154)', async () => {
    const { project, session } = await setupSession('maintainer');
    await agentAutonomyRepo.upsert(project.id, 'dev-api', '*', 'auto_approve');

    const action = await proposeAction.execute(project.id, session.id, {
      actionType: 'git_merge',
      actor: { kind: 'agent', id: 'dev-api' },
      payload: { targetBranch: 'dev' },
    });

    expect(action.resolvedPolicy).toBe('require_approval');
    expect(action.status).toBe('pending');
  });

  it('auto mode NÃO auto-aprova instruction_patch — teto absoluto (RN-154)', async () => {
    const { project, session } = await setupSession('maintainer');
    await agentAutonomyRepo.upsert(project.id, 'anamnese', '*', 'auto_approve');

    const action = await proposeAction.execute(project.id, session.id, {
      actionType: 'instruction_patch',
      actor: { kind: 'agent', id: 'anamnese' },
      payload: {},
    });

    expect(action.resolvedPolicy).toBe('require_approval');
    expect(action.status).toBe('pending');
  });

  it('auto mode NÃO auto-aprova parallelize/raise_max_parallel — teto absoluto (RN-154)', async () => {
    const { project, session } = await setupSession('maintainer');
    await agentAutonomyRepo.upsert(project.id, 'dev-lead', '*', 'auto_approve');

    const pedido = await proposeAction.execute(project.id, session.id, {
      actionType: 'parallelize',
      actor: { kind: 'agent', id: 'dev-lead' },
      payload: {},
    });
    expect(pedido.resolvedPolicy).toBe('require_approval');
    expect(pedido.status).toBe('pending');

    const subirTeto = await proposeAction.execute(project.id, session.id, {
      actionType: 'raise_max_parallel',
      actor: { kind: 'agent', id: 'dev-lead' },
      payload: {},
    });
    expect(subirTeto.resolvedPolicy).toBe('require_approval');
    expect(subirTeto.status).toBe('pending');
  });

  it('regra específica em deny vence a curinga de auto mode pro mesmo tipo', async () => {
    const { project, session } = await setupSession();
    await agentAutonomyRepo.upsert(project.id, 'infra', '*', 'auto_approve');
    await agentAutonomyRepo.upsert(project.id, 'infra', 'terminal', 'deny');

    const action = await proposeAction.execute(project.id, session.id, {
      actionType: 'terminal',
      actor: { kind: 'agent', id: 'infra' },
      payload: { command: 'echo oi' },
    });

    expect(action.status).toBe('denied');
    expect(action.resolvedPolicy).toBe('deny');
  });

  it('git_merge proposto pela aba PRs (produtor real, RN-154) segue pending mesmo com "sempre permitir" já gravado em permissions.json', async () => {
    // Onda 2 do programa de abas agrupadas: a aba PRs é a PRIMEIRA a propor
    // `git_merge` de verdade, com `actor.kind: 'user'` e o payload real que o
    // botão "Merge" envia (pullRequestId/sourceBranch/targetBranch/title).
    // `GitMerge()` (sem especificidade nenhuma — `patternForAction` não
    // discrimina por branch) já em `allow` simula quem clicou "Sempre
    // permitir" numa PR anterior — e mesmo assim a trava de branch protegida
    // continua vencendo por ÚLTIMO em `decide()`.
    const { project, session } = await setupSession('maintainer');
    await permissionsFileStore.write(project, {
      allow: ['GitMerge()'],
      deny: [],
      ask: [],
    });

    const action = await proposeAction.execute(project.id, session.id, {
      actionType: 'git_merge',
      actor: { kind: 'user', id: 'user-1' },
      payload: {
        pullRequestId: '218',
        sourceBranch: 'feature/task-a1b2c3d4',
        targetBranch: 'dev',
        title: 'feat: aba de PRs',
      },
    });

    expect(action.resolvedPolicy).toBe('require_approval');
    expect(action.status).toBe('pending');
  });

  it('git_merge proposto pela aba PRs continua pending mesmo com agent_autonomy curinga ligado pro mesmo ator', async () => {
    // Reforça a suíte já existente da RN-154 (acima, com `actor.kind: 'agent'`)
    // com o produtor real desta onda: o teto é absoluto independente de QUEM
    // propõe. `autonomyMode` só é consultado para `actor.kind === 'agent'`
    // (ver `ProposeActionUseCase.execute`), então este cenário usa um agente —
    // é o que prova que nem essa porta ajudaria.
    const { project, session } = await setupSession('maintainer');
    await agentAutonomyRepo.upsert(project.id, 'dev-lead', '*', 'auto_approve');

    const action = await proposeAction.execute(project.id, session.id, {
      actionType: 'git_merge',
      actor: { kind: 'agent', id: 'dev-lead' },
      payload: {
        pullRequestId: '218',
        sourceBranch: 'feature/task-a1b2c3d4',
        targetBranch: 'main',
        title: 'feat: aba de PRs',
      },
    });

    expect(action.resolvedPolicy).toBe('require_approval');
    expect(action.status).toBe('pending');
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

// ADR 0134/RN-492: o piso de `terminal` DENTRO do container real do
// projeto. `setupSession()` cria projeto `execution_mode: container`
// (default do schema) SEM linha em `project_containers` — por isso a suíte
// de cima já prova "sem container ativo, comportamento de hoje inalterado"
// em toda ação `terminal`; os testes daqui provam o resto: o piso sobe
// quando HÁ uma linha `running`, e os tetos absolutos continuam vencendo
// por cima dele.
describe('ProposeActionUseCase — piso do container ativo (ADR 0134, RN-492)', () => {
  it('terminal auto-aprova e JÁ EXECUTA quando o projeto tem container registrado running, sem NENHUMA regra em permissions.json/agent_autonomy', async () => {
    const { project, session } = await setupSession();
    await marcarContainerRunning(project.id);

    const action = await proposeAction.execute(project.id, session.id, {
      actionType: 'terminal',
      actor: { kind: 'agent', id: 'dev-api' },
      payload: { command: 'npm test' },
    });

    expect(action.resolvedPolicy).toBe('auto_approve');
    expect(action.status).toBe('executed');
    expect(fakeEngineClient.calls).toEqual([
      { actionId: action.id, command: 'npm test' },
    ]);
  });

  it('container running NÃO auto-aprova ação que não é terminal (container_start, por exemplo)', async () => {
    const { project, session } = await setupSession('maintainer');
    await marcarContainerRunning(project.id);

    const action = await proposeAction.execute(project.id, session.id, {
      actionType: 'container_start',
      actor: { kind: 'agent', id: 'infra' },
      payload: {
        imagem: 'node:22-bookworm-slim',
        network: 'none',
        resources: RECURSOS_PADRAO,
        rationale: 'irrelevante para este teste',
      },
    });

    expect(action.resolvedPolicy).toBe('require_approval');
    expect(action.status).toBe('pending');
  });

  it('sem linha `running` em project_containers, comportamento de hoje inalterado (require_approval por padrão)', async () => {
    const { project, session } = await setupSession();
    // Nenhuma linha em project_containers para este projectId — o piso do
    // container só se aplica quando a consulta encontra `status: running`.
    const action = await proposeAction.execute(project.id, session.id, {
      actionType: 'terminal',
      actor: { kind: 'agent', id: 'dev-api' },
      payload: { command: 'echo oi' },
    });

    expect(action.resolvedPolicy).toBe('require_approval');
    expect(action.status).toBe('pending');
  });

  it('deny embutido (rm -rf /) continua vencendo mesmo com container ativo', async () => {
    const { project, session } = await setupSession();
    await marcarContainerRunning(project.id);

    const action = await proposeAction.execute(project.id, session.id, {
      actionType: 'terminal',
      actor: { kind: 'agent', id: 'dev-api' },
      payload: { command: 'rm -rf /' },
    });

    expect(action.status).toBe('denied');
    expect(action.resolvedPolicy).toBe('deny');
    expect(fakeEngineClient.calls).toHaveLength(0);
  });

  it('git push por dentro do terminal continua require_approval mesmo com container ativo — teto absoluto (RN-418/ADR 0102)', async () => {
    const { project, session } = await setupSession();
    await marcarContainerRunning(project.id);
    await permissionsFileStore.write(project, {
      allow: ['Terminal(*)'],
      deny: [],
      ask: [],
    });

    const action = await proposeAction.execute(project.id, session.id, {
      actionType: 'terminal',
      actor: { kind: 'agent', id: 'dev-api' },
      payload: { command: 'git push origin HEAD:feature/x' },
    });

    expect(action.resolvedPolicy).toBe('require_approval');
    expect(action.status).toBe('pending');
    expect(fakeEngineClient.calls).toHaveLength(0);
  });

  it('sudo por dentro do terminal continua require_approval mesmo com container ativo — teto absoluto (RN-418/ADR 0102)', async () => {
    const { project, session } = await setupSession();
    await marcarContainerRunning(project.id);
    await permissionsFileStore.write(project, {
      allow: ['Terminal(*)'],
      deny: [],
      ask: [],
    });

    const action = await proposeAction.execute(project.id, session.id, {
      actionType: 'terminal',
      actor: { kind: 'agent', id: 'dev-api' },
      payload: { command: 'sudo apt-get update' },
    });

    expect(action.resolvedPolicy).toBe('require_approval');
    expect(action.status).toBe('pending');
    expect(fakeEngineClient.calls).toHaveLength(0);
  });

  it('regra explícita de require_approval (permissions.json ask) rebaixa o piso do container — o piso não é um teto', async () => {
    const { project, session } = await setupSession();
    await marcarContainerRunning(project.id);
    await permissionsFileStore.write(project, {
      allow: [],
      deny: [],
      ask: ['Terminal(npm test)'],
    });

    const action = await proposeAction.execute(project.id, session.id, {
      actionType: 'terminal',
      actor: { kind: 'agent', id: 'dev-api' },
      payload: { command: 'npm test' },
    });

    expect(action.resolvedPolicy).toBe('require_approval');
    expect(action.status).toBe('pending');
    expect(fakeEngineClient.calls).toHaveLength(0);
  });
});
