import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { ConflictException } from '@nestjs/common';
import type { GitProviderContract } from '@brabo/shared';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  projects,
  proposedActions,
  sessionEvents,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleUnitOfWork } from '../../../../src/infrastructure/persistence/drizzle/drizzle-unit-of-work';
import { DrizzleProvisionedRepositoryRepository } from '../../../../src/infrastructure/persistence/drizzle/provisioned-repository.repository';
import { DrizzleRepoBootstrapRepository } from '../../../../src/infrastructure/persistence/drizzle/repo-bootstrap.repository';
import { DrizzleOutboxRepository } from '../../../../src/infrastructure/persistence/drizzle/outbox.repository';
import { DrizzleProposedActionRepository } from '../../../../src/infrastructure/persistence/drizzle/proposed-action.repository';
import { DrizzleSessionRepository } from '../../../../src/infrastructure/persistence/drizzle/session.repository';
import { DrizzleSessionEventRepository } from '../../../../src/infrastructure/persistence/drizzle/session-event.repository';
import { DrizzleUserCredentialRepository } from '../../../../src/infrastructure/persistence/drizzle/user-credential.repository';
import { EnvelopeEncryptionService } from '../../../../src/infrastructure/security/envelope-encryption.service';
import { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import { TransitionSessionUseCase } from '../../../../src/application/use-cases/sessions/transition-session.use-case';
import { ProvisionRepositoryUseCase } from '../../../../src/application/use-cases/git/provision-repository.use-case';
import { BootstrapRunner } from '../../../../src/application/use-cases/git/bootstrap-runner';
import { LocalGitProvider } from '../../../../src/infrastructure/git/local-git-provider';
import type { GitProviderRegistry } from '../../../../src/application/ports/git-provider.port';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import { CreateSessionUseCase } from '../../../../src/application/use-cases/sessions/create-session.use-case';

const { db, pool } = createTestDb();

const unitOfWork = new DrizzleUnitOfWork(db);
const repositories = new DrizzleProvisionedRepositoryRepository(db);
const repoBootstraps = new DrizzleRepoBootstrapRepository(db);
const outbox = new DrizzleOutboxRepository(db);
const proposedActionsRepo = new DrizzleProposedActionRepository(db);
const sessionRepo = new DrizzleSessionRepository(db);
const sessionEventRepo = new DrizzleSessionEventRepository(db);
const userCredentials = new DrizzleUserCredentialRepository(db);
const encryption = new EnvelopeEncryptionService();
const appendSessionEvent = new AppendSessionEventUseCase(
  unitOfWork,
  sessionRepo,
  sessionEventRepo,
  outbox,
);

// Nunca deveria ser chamado — o bootstrap só usa TransitionSessionUseCase
// pra 'closing'/'closed', nunca 'active' (ver docs/adr/0005), então o
// engine nunca é acionado por esse fluxo.
class UnreachableEngineClient implements ApiToEngineClient {
  startSession(): Promise<void> {
    throw new Error('engine não deveria ser chamado pelo bootstrap');
  }
  startAgent(): Promise<void> {
    throw new Error('engine não deveria ser chamado pelo bootstrap');
  }
  sendAgentMessage(): Promise<void> {
    throw new Error('engine não deveria ser chamado pelo bootstrap');
  }
  confirmReadiness(): Promise<void> {
    throw new Error('engine não deveria ser chamado pelo bootstrap');
  }
  startExecution(): Promise<void> {
    throw new Error('engine não deveria ser chamado pelo bootstrap');
  }
  executeGitAction(): Promise<Record<string, unknown>> {
    throw new Error('engine não deveria ser chamado pelo bootstrap');
  }
  acceptParallelization(): Promise<void> {
    throw new Error('engine não deveria ser chamado pelo bootstrap');
  }
  rearmDevAgent(): Promise<void> {
    throw new Error('engine não deveria ser chamado pelo bootstrap');
  }
  reviseStory(): Promise<void> {
    throw new Error('engine não deveria ser chamado pelo bootstrap');
  }
  offerInfraHandoff(): Promise<void> {
    throw new Error('engine não deveria ser chamado pelo bootstrap');
  }
  reanalyzeSession(): Promise<void> {
    throw new Error('engine não deveria ser chamado pelo bootstrap');
  }

  runAnamnese(): Promise<void> {
    throw new Error('engine não deveria ser chamado pelo bootstrap');
  }
  invalidateInstructions(): Promise<void> {
    throw new Error('engine não deveria ser chamado pelo bootstrap');
  }
  executeTerminalAction(): Promise<never> {
    throw new Error('engine não deveria ser chamado pelo bootstrap');
  }
}

const transitionSession = new TransitionSessionUseCase(
  unitOfWork,
  sessionRepo,
  outbox,
  new UnreachableEngineClient(),
);

// Envolve um GitProviderContract real (LocalGitProvider) contando chamadas
// por método e, opcionalmente, lançando na PRÓXIMA chamada de um método
// escolhido — usado pra simular "o processo morreu no meio do passo N".
class InstrumentedGitProvider implements GitProviderContract {
  readonly callCounts: Record<string, number> = {};
  private failNext: { method: string; skipCalls: number } | null = null;

  constructor(private readonly inner: GitProviderContract) {}

  get name() {
    return this.inner.name;
  }

  get capabilities() {
    return this.inner.capabilities;
  }

  /** Lança na (skipCalls+1)ª chamada de `method` — deixa as `skipCalls`
   * anteriores passarem normalmente, pra atingir uma chamada específica
   * no meio da sequência (ex.: a 2ª de `createBranch`, não a 1ª). */
  failNextCallTo(method: string, skipCalls = 0): void {
    this.failNext = { method, skipCalls };
  }

  private async track<T>(method: string, fn: () => Promise<T>): Promise<T> {
    this.callCounts[method] = (this.callCounts[method] ?? 0) + 1;
    if (this.failNext?.method === method) {
      if (this.failNext.skipCalls > 0) {
        this.failNext.skipCalls -= 1;
      } else {
        this.failNext = null;
        throw new Error(`falha injetada em ${method}`);
      }
    }
    return fn();
  }

  createRepo: GitProviderContract['createRepo'] = (input) =>
    this.track('createRepo', () => this.inner.createRepo(input));
  getRepo: GitProviderContract['getRepo'] = (input) =>
    this.track('getRepo', () => this.inner.getRepo(input));
  createBranch: GitProviderContract['createBranch'] = (input) =>
    this.track('createBranch', () => this.inner.createBranch(input));
  protectBranch: GitProviderContract['protectBranch'] = (input) =>
    this.track('protectBranch', () => this.inner.protectBranch(input));
  commitFiles: GitProviderContract['commitFiles'] = (input) =>
    this.track('commitFiles', () => this.inner.commitFiles(input));
  listBranches: GitProviderContract['listBranches'] = (input) =>
    this.track('listBranches', () => this.inner.listBranches(input));
  openPullRequest: GitProviderContract['openPullRequest'] = (input) =>
    this.track('openPullRequest', () => this.inner.openPullRequest(input));
  mergePullRequest: GitProviderContract['mergePullRequest'] = (input) =>
    this.track('mergePullRequest', () => this.inner.mergePullRequest(input));
  getFileContent: GitProviderContract['getFileContent'] = (input) =>
    this.track('getFileContent', () => this.inner.getFileContent(input));
  commentOnPullRequest: GitProviderContract['commentOnPullRequest'] = (input) =>
    this.track('commentOnPullRequest', () =>
      this.inner.commentOnPullRequest(input),
    );
}

function registryFor(provider: GitProviderContract): GitProviderRegistry {
  return { get: () => provider };
}

function buildUseCase(provider: GitProviderContract) {
  return new ProvisionRepositoryUseCase(
    unitOfWork,
    userCredentials,
    encryption,
    registryFor(provider),
    repositories,
    repoBootstraps,
    outbox,
    proposedActionsRepo,
    sessionRepo,
    new CreateSessionUseCase(unitOfWork, sessionRepo, outbox),
    appendSessionEvent,
    transitionSession,
    // Fase 12a: o runner saiu daqui pra um colaborador próprio, sem uma
    // linha de comportamento alterada — os testes abaixo (idempotência
    // 3× e retomada inclusas) não mudaram, e é isso que prova a extração.
    new BootstrapRunner(
      unitOfWork,
      repoBootstraps,
      outbox,
      proposedActionsRepo,
      appendSessionEvent,
    ),
  );
}

async function setupProject() {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-provision', email: 'provision@brabo.dev' })
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
  return { user, project };
}

async function eventsFor(sessionId: string) {
  const rows = await db
    .select()
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, sessionId));
  return rows.sort((a, b) => a.seq - b.seq);
}

let repoRoot: string;

beforeEach(async () => {
  await truncateAll(db);
  repoRoot = await mkdtemp(join(tmpdir(), 'brabo-bootstrap-test-'));
  process.env.GIT_LOCAL_REPOS_ROOT = repoRoot;
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

afterAll(async () => {
  await pool.end();
});

describe('ProvisionRepositoryUseCase', () => {
  it('local: cria o repo, converge os 5 passos, degrada protect_branches com aviso (não erro)', async () => {
    const { user, project } = await setupProject();
    const provider = new InstrumentedGitProvider(new LocalGitProvider());
    const useCase = buildUseCase(provider);

    const result = await useCase.execute(project.id, user.id, {
      provider: 'local',
      name: 'meu-repo',
      visibility: 'private',
    });

    expect(result.bootstrap.step).toBe('protect_branches');
    expect(result.bootstrap.status).toBe('done');

    const bootstrapRow = await repoBootstraps.findByProjectId(project.id);
    expect(bootstrapRow?.status).toBe('done');
    expect(bootstrapRow?.attempts).toBe(0);
    // Fase 12a (RN-046): este caminho CRIA — a origem tem que dizer isso,
    // e não sobrar como default silencioso da coluna.
    expect(bootstrapRow?.origin).toBe('created');
    expect(result.repository.origin).toBe('created');

    const session = await sessionRepo.findInProject(
      project.id,
      bootstrapRow!.sessionId,
    );
    expect(session?.status).toBe('closed');

    const events = await eventsFor(bootstrapRow!.sessionId);
    const types = events.map((e) => e.type);
    expect(types).toContain('bootstrap.step_completed');
    expect(types).toContain('bootstrap.step_degraded');
    expect(types).not.toContain('bootstrap.step_failed');

    const degraded = events.find((e) => e.type === 'bootstrap.step_degraded');
    expect(degraded?.payload).toMatchObject({
      step: 'protect_branches',
      reason: 'capability_unsupported',
      provider: 'local',
    });

    const actions = await db
      .select()
      .from(proposedActions)
      .where(eq(proposedActions.sessionId, bootstrapRow!.sessionId));
    // git_repo_create + 2 git_branch_create (dev/qa) + 2 git_commit —
    // nenhum git_branch_protect (degradado, sem mutação de verdade). Eram 3
    // branches até o degrau `rc` sair do template (ADR 0030, achado #3).
    expect(actions).toHaveLength(5);
    expect(actions.every((a) => a.status === 'executed')).toBe(true);
    expect(actions.every((a) => a.resolvedPolicy === 'auto_approve')).toBe(
      true,
    );
  });

  it('idempotência: rodar 3x converge pro mesmo estado, sem duplicar mutações nem erro', async () => {
    const { user, project } = await setupProject();
    const provider = new InstrumentedGitProvider(new LocalGitProvider());
    const useCase = buildUseCase(provider);

    await useCase.execute(project.id, user.id, {
      provider: 'local',
      name: 'idem-repo',
      visibility: 'private',
    });
    const countsAfterFirst = { ...provider.callCounts };

    await useCase.execute(project.id, user.id, {
      provider: 'local',
      name: 'idem-repo',
      visibility: 'private',
    });
    await useCase.execute(project.id, user.id, {
      provider: 'local',
      name: 'idem-repo',
      visibility: 'private',
    });

    // Nenhuma mutação nova — createBranch/commitFiles nunca chamados de
    // novo (só listBranches/getFileContent, que são as checagens).
    expect(provider.callCounts.createBranch).toBe(
      countsAfterFirst.createBranch,
    );
    expect(provider.callCounts.commitFiles).toBe(countsAfterFirst.commitFiles);
    expect(provider.callCounts.createRepo).toBe(1);

    const bootstrapRow = await repoBootstraps.findByProjectId(project.id);
    expect(bootstrapRow?.step).toBe('protect_branches');
    expect(bootstrapRow?.status).toBe('done');

    const events = await eventsFor(bootstrapRow!.sessionId);
    const skipsAfterReruns = events.filter(
      (e) => e.type === 'bootstrap.step_skipped',
    );
    const degradedAfterReruns = events.filter(
      (e) => e.type === 'bootstrap.step_degraded',
    );
    // 4 passos com mutação real (2 commits + 2 branches) * 2 reruns = 8
    // skips — protect_branches nunca é "skipped", sempre "degraded" (não
    // suportado pelo Local, independente de progresso prévio) — 3
    // ocorrências no total (1ª execução + 2 reruns).
    expect(skipsAfterReruns.length).toBe(8);
    expect(degradedAfterReruns.length).toBe(3);
  });

  it('retomada: falha injetada no meio revalida os passos 1-3 (sem recriar) e converge', async () => {
    const { user, project } = await setupProject();
    const provider = new InstrumentedGitProvider(new LocalGitProvider());
    const useCase = buildUseCase(provider);

    // Mata o processo na 2ª chamada de createBranch (create_qa_branch) —
    // depois dos 2 commits em main e da criação de dev (passos 1-3 já
    // resolvidos), no meio da criação de qa/rc/proteção (passos 4-6).
    provider.failNextCallTo('createBranch', 1);

    await expect(
      useCase.execute(project.id, user.id, {
        provider: 'local',
        name: 'retomada-repo',
        visibility: 'private',
      }),
    ).rejects.toThrow('falha injetada em createBranch');

    const failedRow = await repoBootstraps.findByProjectId(project.id);
    expect(failedRow?.step).toBe('create_qa_branch');
    expect(failedRow?.status).toBe('failed');
    expect(failedRow?.attempts).toBe(1);
    expect(failedRow?.lastError).toContain('falha injetada em createBranch');

    const session = await sessionRepo.findInProject(
      project.id,
      failedRow!.sessionId,
    );
    expect(session?.status).toBe('active'); // nunca closed_abnormally

    const commitFilesCallsBeforeResume = provider.callCounts.commitFiles;
    const getFileContentCallsBeforeResume = provider.callCounts.getFileContent;

    const result = await useCase.execute(project.id, user.id, {
      provider: 'local',
      name: 'retomada-repo',
      visibility: 'private',
    });

    expect(result.bootstrap.status).toBe('done');
    expect(result.bootstrap.step).toBe('protect_branches');

    // Passos 1-2 (commit de arquivo) REVALIDADOS (getFileContent chamado
    // de novo) mas NÃO recomitados (commitFiles não chamado de novo).
    expect(provider.callCounts.commitFiles).toBe(commitFilesCallsBeforeResume);
    expect(provider.callCounts.getFileContent).toBeGreaterThan(
      getFileContentCallsBeforeResume,
    );

    const bootstrapRow = await repoBootstraps.findByProjectId(project.id);
    expect(bootstrapRow?.attempts).toBe(0);
    expect(bootstrapRow?.lastError).toBeNull();

    const events = await eventsFor(bootstrapRow!.sessionId);
    const types = events.map((e) => e.type);
    expect(types).toContain('bootstrap.step_failed');
    // Passos 1-2 (commits) revalidados e pulados na retomada — prova que
    // "revalida mas não refaz" também vale pros passos de commit, não só
    // pras branches.
    expect(
      types.filter((t) => t === 'bootstrap.step_skipped').length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('rejeita provisionar github sem credencial cadastrada, sem tocar no provider', async () => {
    const { user, project } = await setupProject();
    const provider = new InstrumentedGitProvider(new LocalGitProvider());
    const useCase = buildUseCase(provider);

    await expect(
      useCase.execute(project.id, user.id, {
        provider: 'github',
        name: 'sem-credencial',
        visibility: 'private',
      }),
    ).rejects.toThrow(ConflictException);

    expect(provider.callCounts.createRepo).toBeUndefined();
    const bootstrapRow = await repoBootstraps.findByProjectId(project.id);
    expect(bootstrapRow).toBeNull();
  });
});
