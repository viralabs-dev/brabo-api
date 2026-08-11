import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConflictException } from '@nestjs/common';
import type { GitProviderContract } from '@brabo/shared';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { projects, users, workspaces } from '../../../../src/db/schema';
import { DrizzleUnitOfWork } from '../../../../src/infrastructure/persistence/drizzle/drizzle-unit-of-work';
import { DrizzleProvisionedRepositoryRepository } from '../../../../src/infrastructure/persistence/drizzle/provisioned-repository.repository';
import { DrizzleRepoBootstrapRepository } from '../../../../src/infrastructure/persistence/drizzle/repo-bootstrap.repository';
import { DrizzleOutboxRepository } from '../../../../src/infrastructure/persistence/drizzle/outbox.repository';
import { DrizzleSessionRepository } from '../../../../src/infrastructure/persistence/drizzle/session.repository';
import { DrizzleSessionEventRepository } from '../../../../src/infrastructure/persistence/drizzle/session-event.repository';
import { DrizzleUserCredentialRepository } from '../../../../src/infrastructure/persistence/drizzle/user-credential.repository';
import { EnvelopeEncryptionService } from '../../../../src/infrastructure/security/envelope-encryption.service';
import { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import { AdoptRepositoryUseCase } from '../../../../src/application/use-cases/git/adopt-repository.use-case';
import { LocalGitProvider } from '../../../../src/infrastructure/git/local-git-provider';
import {
  GitPermissionDeniedError,
  GitRepoNotFoundError,
} from '../../../../src/domain/git/git-errors';
import type { GitProviderRegistry } from '../../../../src/application/ports/git-provider.port';
import { CreateSessionUseCase } from '../../../../src/application/use-cases/sessions/create-session.use-case';

const { db, pool } = createTestDb();

const unitOfWork = new DrizzleUnitOfWork(db);
const repositories = new DrizzleProvisionedRepositoryRepository(db);
const repoBootstraps = new DrizzleRepoBootstrapRepository(db);
const outbox = new DrizzleOutboxRepository(db);
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

/**
 * Envolve um provider real e EXPLODE se `createRepo` for chamado — a
 * garantia central da adoção (achado P1 #1 do dogfooding: o produto só
 * sabia criar). Um mock que só contasse chamadas deixaria o teste passar
 * com o repositório já criado no disco.
 */
class NuncaCriaGitProvider implements GitProviderContract {
  constructor(private readonly inner: GitProviderContract) {}

  get name() {
    return this.inner.name;
  }
  get capabilities() {
    return this.inner.capabilities;
  }

  createRepo(): never {
    throw new Error('createRepo NÃO pode ser chamado na adoção');
  }

  getRepo: GitProviderContract['getRepo'] = (i) => this.inner.getRepo(i);
  createBranch: GitProviderContract['createBranch'] = (i) =>
    this.inner.createBranch(i);
  protectBranch: GitProviderContract['protectBranch'] = (i) =>
    this.inner.protectBranch(i);
  commitFiles: GitProviderContract['commitFiles'] = (i) =>
    this.inner.commitFiles(i);
  listBranches: GitProviderContract['listBranches'] = (i) =>
    this.inner.listBranches(i);
  openPullRequest: GitProviderContract['openPullRequest'] = (i) =>
    this.inner.openPullRequest(i);
  mergePullRequest: GitProviderContract['mergePullRequest'] = (i) =>
    this.inner.mergePullRequest(i);
  getFileContent: GitProviderContract['getFileContent'] = (i) =>
    this.inner.getFileContent(i);
  commentOnPullRequest: GitProviderContract['commentOnPullRequest'] = (i) =>
    this.inner.commentOnPullRequest(i);
  listTree: GitProviderContract['listTree'] = (i) => this.inner.listTree(i);
  getPullRequestDiff: GitProviderContract['getPullRequestDiff'] = (i) =>
    this.inner.getPullRequestDiff(i);
}

/** Provider que falha o `getRepo` com o erro pedido — o resto não importa. */
function providerQueFalhaEm(error: Error): GitProviderContract {
  return {
    name: 'github',
    capabilities: { protectBranch: true, pullRequests: true },
    getRepo: () => Promise.reject(error),
  } as unknown as GitProviderContract;
}

function registryFor(provider: GitProviderContract): GitProviderRegistry {
  return { get: () => provider };
}

function buildUseCase(provider: GitProviderContract) {
  return new AdoptRepositoryUseCase(
    unitOfWork,
    userCredentials,
    encryption,
    registryFor(provider),
    repositories,
    repoBootstraps,
    outbox,
    sessionRepo,
    new CreateSessionUseCase(unitOfWork, sessionRepo, outbox),
    appendSessionEvent,
  );
}

async function setupProject() {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-adopt', email: 'adopt@brabo.dev' })
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

/** Um bare repo de verdade, com uma branch `main` já comitada. */
let tmpRoot: string;
async function repoExistente(nome: string): Promise<string> {
  const local = new LocalGitProvider();
  const repo = await local.createRepo({
    name: nome,
    visibility: 'private',
  });
  await local.commitFiles({
    externalId: repo.externalId,
    branch: 'main',
    message: 'chore: conteúdo preexistente',
    files: [{ path: 'README.md', content: '# já existia' }],
  });
  return repo.externalId;
}

beforeEach(async () => {
  await truncateAll(db);
  // Raiz por teste: os casos abaixo criam repos de mesmo nome, e um
  // diretório compartilhado faria o segundo colidir com o primeiro.
  tmpRoot = await mkdtemp(join(tmpdir(), 'brabo-adopt-'));
  process.env.GIT_LOCAL_REPOS_ROOT = tmpRoot;
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

afterAll(async () => {
  await pool.end();
});

describe('AdoptRepositoryUseCase', () => {
  it('adota um repositório existente sem NUNCA chamar createRepo', async () => {
    const { user, project } = await setupProject();
    const externalId = await repoExistente('checkout');
    const useCase = buildUseCase(
      new NuncaCriaGitProvider(new LocalGitProvider()),
    );

    const result = await useCase.execute(project.id, user.id, {
      provider: 'local',
      externalId,
    });

    expect(result.repository.externalId).toBe(externalId);
    expect(result.repository.origin).toBe('adopted');
    expect(result.alreadyAdopted).toBe(false);

    const row = await repositories.findByProjectId(project.id);
    expect(row?.origin).toBe('adopted');
    expect(row?.defaultBranch).toBe('main');
  });

  it('o bootstrap NÃO roda: sai um plano, e o repositório fica intocado', async () => {
    const { user, project } = await setupProject();
    const externalId = await repoExistente('checkout');
    const provider = new LocalGitProvider();
    const useCase = buildUseCase(new NuncaCriaGitProvider(provider));

    const result = await useCase.execute(project.id, user.id, {
      provider: 'local',
      externalId,
    });

    // O plano diz o que FARIA...
    expect(result.plan.steps.length).toBeGreaterThan(0);
    expect(
      result.plan.steps
        .filter((s) => s.actionType === 'git_branch_create')
        .map((s) => s.payload.branchName),
    ).toEqual(['dev', 'qa']);

    // ...e o repositório continua só com `main` (RN-045: nada roda antes
    // da decisão).
    const branches = await provider.listBranches({ externalId });
    expect(branches.map((b) => b.name)).toEqual(['main']);

    const bootstrap = await repoBootstraps.findByProjectId(project.id);
    expect(bootstrap?.origin).toBe('adopted');
    expect(bootstrap?.planDecision).toBeNull();
    expect(bootstrap?.plan).not.toBeNull();
    expect(bootstrap?.status).toBe('pending');
  });

  it('404 e 403 produzem mensagens DISTINTAS e acionáveis', async () => {
    const { user, project } = await setupProject();

    const naoExiste = buildUseCase(
      providerQueFalhaEm(new GitRepoNotFoundError('acme/sumido')),
    );
    const erro404 = await naoExiste
      .execute(project.id, user.id, {
        provider: 'local',
        externalId: 'acme/sumido',
      })
      .catch((e: unknown) => e);

    const semAcesso = buildUseCase(
      providerQueFalhaEm(new GitPermissionDeniedError('acme/privado')),
    );
    const erro403 = await semAcesso
      .execute(project.id, user.id, {
        provider: 'local',
        externalId: 'acme/privado',
      })
      .catch((e: unknown) => e);

    // A CLASSE é o que o filtro HTTP traduz em 404 vs 403 — não podem
    // colapsar numa só.
    expect(erro404).toBeInstanceOf(GitRepoNotFoundError);
    expect(erro403).toBeInstanceOf(GitPermissionDeniedError);

    // E a mensagem tem que dizer o que FAZER, que é diferente em cada
    // caso: conferir o identificador vs trocar a credencial.
    expect((erro404 as Error).message).toContain('confira o identificador');
    expect((erro403 as Error).message).toContain('não tem acesso');
    expect((erro403 as Error).message).not.toContain('confira o identificador');

    // Nada foi gravado em nenhum dos dois casos.
    expect(await repositories.findByProjectId(project.id)).toBeNull();
  });

  it('adotar o MESMO repo duas vezes converge: não duplica linha, regenera o plano', async () => {
    const { user, project } = await setupProject();
    const externalId = await repoExistente('checkout');
    const useCase = buildUseCase(
      new NuncaCriaGitProvider(new LocalGitProvider()),
    );
    const input = { provider: 'local' as const, externalId };

    const primeira = await useCase.execute(project.id, user.id, input);
    const segunda = await useCase.execute(project.id, user.id, input);

    expect(primeira.alreadyAdopted).toBe(false);
    expect(segunda.alreadyAdopted).toBe(true);
    expect(segunda.repository.id).toBe(primeira.repository.id);

    // Uma linha só em cada tabela — o `unique(project_id)` nem chega a
    // ser exercitado, porque a segunda adoção não tenta inserir.
    const linhas = await db.select().from(projects);
    expect(linhas).toHaveLength(1);
    expect(await repositories.findByProjectId(project.id)).toMatchObject({
      id: primeira.repository.id,
      origin: 'adopted',
    });

    const bootstrap = await repoBootstraps.findByProjectId(project.id);
    expect(bootstrap?.plan).not.toBeNull();
  });

  it('projeto que já aponta pra outro repositório recusa com 409 acionável', async () => {
    const { user, project } = await setupProject();
    const primeiro = await repoExistente('checkout');
    const outro = await repoExistente('outro');
    const useCase = buildUseCase(
      new NuncaCriaGitProvider(new LocalGitProvider()),
    );

    await useCase.execute(project.id, user.id, {
      provider: 'local',
      externalId: primeiro,
    });

    const erro = await useCase
      .execute(project.id, user.id, { provider: 'local', externalId: outro })
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ConflictException);
    expect((erro as Error).message).toContain(primeiro);
    expect((erro as Error).message).toContain('aponta para um repositório só');
  });

  it('projeto com repositório CRIADO pelo Brabo não pode ser adotado por cima', async () => {
    const { user, project } = await setupProject();
    const externalId = await repoExistente('checkout');

    // Simula o estado pós-provisionamento normal.
    await repositories.create({
      projectId: project.id,
      provider: 'local',
      externalId,
      url: `file://${externalId}`,
      defaultBranch: 'main',
      visibility: 'private',
      origin: 'created',
      provisionedBy: user.id,
    });

    const useCase = buildUseCase(
      new NuncaCriaGitProvider(new LocalGitProvider()),
    );
    const erro = await useCase
      .execute(project.id, user.id, { provider: 'local', externalId })
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ConflictException);
    expect((erro as Error).message).toContain('criado pelo Brabo');
  });
});
