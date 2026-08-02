import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { ConflictException } from '@nestjs/common';
import type { GitBranch, GitProviderContract } from '@brabo/shared';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  projects,
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
import { AdoptRepositoryUseCase } from '../../../../src/application/use-cases/git/adopt-repository.use-case';
import { DecideBootstrapPlanUseCase } from '../../../../src/application/use-cases/git/decide-bootstrap-plan.use-case';
import { BootstrapRunner } from '../../../../src/application/use-cases/git/bootstrap-runner';
import { LocalGitProvider } from '../../../../src/infrastructure/git/local-git-provider';
import { deriveProvisioningStatus } from '../../../../src/domain/git/repo-bootstrap-status';
import type { GitProviderRegistry } from '../../../../src/application/ports/git-provider.port';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';

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

class UnreachableEngineClient implements ApiToEngineClient {
  private boom(): never {
    throw new Error('engine não deveria ser chamado pelo bootstrap');
  }
  startSession = () => this.boom();
  startAgent = () => this.boom();
  sendAgentMessage = () => this.boom();
  confirmReadiness = () => this.boom();
  startExecution = () => this.boom();
  executeGitAction = () => this.boom();
  acceptParallelization = () => this.boom();
  rearmDevAgent = () => this.boom();
  offerInfraHandoff = () => this.boom();
  reanalyzeSession = () => this.boom();
  runAnamnese = () => this.boom();
  invalidateInstructions = () => this.boom();
  executeTerminalAction = () => this.boom();
}

const transitionSession = new TransitionSessionUseCase(
  unitOfWork,
  sessionRepo,
  outbox,
  new UnreachableEngineClient(),
);

/**
 * `LocalGitProvider` não sabe proteger branch (capability false), e a
 * RN-045 é justamente sobre proteção. Este wrapper dá a capability e
 * REGISTRA cada `protectBranch` — é assim que o teste prova os dois
 * lados: com aprovação, protege; sem aprovação, `protegidas` fica vazio.
 */
class ProtecaoObservavelProvider implements GitProviderContract {
  readonly protegidas: string[] = [];
  readonly capabilities = { protectBranch: true, pullRequests: true };

  constructor(private readonly inner: GitProviderContract) {}

  get name() {
    return this.inner.name;
  }

  protectBranch: GitProviderContract['protectBranch'] = (input) => {
    this.protegidas.push(input.branchName);
    return Promise.resolve();
  };

  listBranches: GitProviderContract['listBranches'] = async (input) => {
    const branches = await this.inner.listBranches(input);
    // Reflete o que este wrapper "protegeu", já que o local não persiste.
    return branches.map((b): GitBranch => ({
      ...b,
      protected: this.protegidas.includes(b.name),
    }));
  };

  createRepo: GitProviderContract['createRepo'] = (i) =>
    this.inner.createRepo(i);
  getRepo: GitProviderContract['getRepo'] = (i) => this.inner.getRepo(i);
  createBranch: GitProviderContract['createBranch'] = (i) =>
    this.inner.createBranch(i);
  commitFiles: GitProviderContract['commitFiles'] = (i) =>
    this.inner.commitFiles(i);
  openPullRequest: GitProviderContract['openPullRequest'] = (i) =>
    this.inner.openPullRequest(i);
  mergePullRequest: GitProviderContract['mergePullRequest'] = (i) =>
    this.inner.mergePullRequest(i);
  getFileContent: GitProviderContract['getFileContent'] = (i) =>
    this.inner.getFileContent(i);
  commentOnPullRequest: GitProviderContract['commentOnPullRequest'] = (i) =>
    this.inner.commentOnPullRequest(i);
}

function registryFor(provider: GitProviderContract): GitProviderRegistry {
  return { get: () => provider };
}

function buildUseCases(provider: GitProviderContract) {
  const registry = registryFor(provider);
  return {
    adopt: new AdoptRepositoryUseCase(
      unitOfWork,
      userCredentials,
      encryption,
      registry,
      repositories,
      repoBootstraps,
      outbox,
      sessionRepo,
      appendSessionEvent,
    ),
    decide: new DecideBootstrapPlanUseCase(
      userCredentials,
      encryption,
      registry,
      repositories,
      repoBootstraps,
      sessionRepo,
      appendSessionEvent,
      transitionSession,
      new BootstrapRunner(
        unitOfWork,
        repoBootstraps,
        outbox,
        proposedActionsRepo,
        appendSessionEvent,
      ),
    ),
  };
}

async function setupProject() {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-decide', email: 'decide@brabo.dev' })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: user.id })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: 'checkout',
      slug: 'checkout',
      createdBy: user.id,
    })
    .returning();
  return { user, project };
}

let tmpRoot: string;
async function repoExistente(nome: string): Promise<string> {
  const local = new LocalGitProvider();
  const repo = await local.createRepo({ name: nome, visibility: 'private' });
  await local.commitFiles({
    externalId: repo.externalId,
    branch: 'main',
    message: 'chore: conteúdo preexistente',
    files: [{ path: 'README.md', content: '# já existia' }],
  });
  return repo.externalId;
}

async function eventsFor(sessionId: string) {
  return db
    .select()
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, sessionId));
}

beforeEach(async () => {
  await truncateAll(db);
  tmpRoot = await mkdtemp(join(tmpdir(), 'brabo-decide-'));
  process.env.GIT_LOCAL_REPOS_ROOT = tmpRoot;
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

afterAll(async () => {
  await pool.end();
});

describe('DecideBootstrapPlanUseCase — o portão da RN-045', () => {
  it('SEM aprovação, nenhuma branch é protegida e nada é criado', async () => {
    const { user, project } = await setupProject();
    const externalId = await repoExistente('checkout');
    const provider = new ProtecaoObservavelProvider(new LocalGitProvider());
    const { adopt } = buildUseCases(provider);

    await adopt.execute(project.id, user.id, { provider: 'local', externalId });

    // O plano existe e diz o que faria...
    const bootstrap = await repoBootstraps.findByProjectId(project.id);
    expect(bootstrap?.plan?.steps.length).toBeGreaterThan(0);
    expect(bootstrap?.planDecision).toBeNull();

    // ...e o repositório está INTOCADO.
    expect(provider.protegidas).toEqual([]);
    const branches = await new LocalGitProvider().listBranches({ externalId });
    expect(branches.map((b) => b.name)).toEqual(['main']);

    // O projeto fica esperando decisão, não "provisionando" pra sempre.
    expect(deriveProvisioningStatus(bootstrap)).toBe('awaiting_plan_decision');
  });

  it('COM aprovação, o bootstrap roda e as branches são protegidas', async () => {
    const { user, project } = await setupProject();
    const externalId = await repoExistente('checkout');
    const provider = new ProtecaoObservavelProvider(new LocalGitProvider());
    const { adopt, decide } = buildUseCases(provider);

    const adotado = await adopt.execute(project.id, user.id, {
      provider: 'local',
      externalId,
    });

    const resultado = await decide.approve(project.id, user.id, {
      planGeneratedAt: adotado.plan.generatedAt,
    });

    expect(resultado.bootstrap.step).toBe('protect_branches');
    expect(resultado.bootstrap.status).toBe('done');
    expect(provider.protegidas).toEqual(['main', 'rc', 'qa', 'dev']);

    const branches = await new LocalGitProvider().listBranches({ externalId });
    expect(branches.map((b) => b.name).sort()).toEqual([
      'dev',
      'main',
      'qa',
      'rc',
    ]);

    const bootstrap = await repoBootstraps.findByProjectId(project.id);
    expect(bootstrap?.planDecision).toBe('approved');
    expect(bootstrap?.planDecidedBy).toBe(user.id);
    expect(deriveProvisioningStatus(bootstrap)).toBe('provisioned');
  });

  it('adotar como está: dispensa o bootstrap, registra evento e fica operável', async () => {
    const { user, project } = await setupProject();
    const externalId = await repoExistente('checkout');
    const provider = new ProtecaoObservavelProvider(new LocalGitProvider());
    const { adopt, decide } = buildUseCases(provider);

    const adotado = await adopt.execute(project.id, user.id, {
      provider: 'local',
      externalId,
    });
    await decide.adoptAsIs(project.id, user.id, {
      planGeneratedAt: adotado.plan.generatedAt,
    });

    expect(provider.protegidas).toEqual([]);
    const branches = await new LocalGitProvider().listBranches({ externalId });
    expect(branches.map((b) => b.name)).toEqual(['main']);

    const bootstrap = await repoBootstraps.findByProjectId(project.id);
    expect(bootstrap?.planDecision).toBe('as_is');
    // O cursor NÃO é adulterado — nenhum passo rodou, e o registro diz
    // isso. Quem torna o projeto operável é a decisão.
    expect(bootstrap?.step).toBe('create_dev_branch');
    expect(bootstrap?.status).toBe('pending');
    expect(deriveProvisioningStatus(bootstrap)).toBe('provisioned');

    // E o plano fica guardado como evidência do que não foi aplicado.
    expect(bootstrap?.plan?.steps.length).toBeGreaterThan(0);

    const tipos = (await eventsFor(bootstrap!.sessionId)).map((e) => e.type);
    expect(tipos).toContain('bootstrap.adopted_as_is');
    expect(tipos).not.toContain('bootstrap.step_completed');
  });

  it('decidir sobre um plano REGERADO responde 409', async () => {
    const { user, project } = await setupProject();
    const externalId = await repoExistente('checkout');
    const { adopt, decide } = buildUseCases(
      new ProtecaoObservavelProvider(new LocalGitProvider()),
    );

    const primeiro = await adopt.execute(project.id, user.id, {
      provider: 'local',
      externalId,
    });
    // Readoção regenera o plano — o que o usuário tinha na tela envelheceu.
    await adopt.execute(project.id, user.id, { provider: 'local', externalId });

    const erro = await decide
      .approve(project.id, user.id, {
        planGeneratedAt: primeiro.plan.generatedAt,
      })
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ConflictException);
    expect((erro as Error).message).toContain('regerado');
  });

  it('decidir duas vezes recusa — a decisão é única por plano', async () => {
    const { user, project } = await setupProject();
    const externalId = await repoExistente('checkout');
    const { adopt, decide } = buildUseCases(
      new ProtecaoObservavelProvider(new LocalGitProvider()),
    );

    const adotado = await adopt.execute(project.id, user.id, {
      provider: 'local',
      externalId,
    });
    const decisao = { planGeneratedAt: adotado.plan.generatedAt };
    await decide.adoptAsIs(project.id, user.id, decisao);

    const erro = await decide
      .approve(project.id, user.id, decisao)
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ConflictException);
    expect((erro as Error).message).toContain('já foi decidido');
  });

  it('projeto sem repositório adotado não tem plano a decidir', async () => {
    const { user, project } = await setupProject();
    const { decide } = buildUseCases(
      new ProtecaoObservavelProvider(new LocalGitProvider()),
    );

    const erro = await decide
      .approve(project.id, user.id, {
        planGeneratedAt: new Date().toISOString(),
      })
      .catch((e: unknown) => e);

    expect((erro as Error).message).toContain('sem repositório adotado');
  });
});
