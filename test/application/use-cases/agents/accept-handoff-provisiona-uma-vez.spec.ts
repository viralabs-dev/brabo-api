import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { GitProviderContract } from '@brabo/shared';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  projectRepositories,
  projects,
  repoBootstraps as repoBootstrapsTable,
  sessions as sessionsTable,
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
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';
import { EnvelopeEncryptionService } from '../../../../src/infrastructure/security/envelope-encryption.service';
import { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import { TransitionSessionUseCase } from '../../../../src/application/use-cases/sessions/transition-session.use-case';
import { CreateSessionUseCase } from '../../../../src/application/use-cases/sessions/create-session.use-case';
import { ProvisionRepositoryUseCase } from '../../../../src/application/use-cases/git/provision-repository.use-case';
import { BootstrapRunner } from '../../../../src/application/use-cases/git/bootstrap-runner';
import { AcceptHandoffUseCase } from '../../../../src/application/use-cases/agents/accept-handoff.use-case';
import { LocalGitProvider } from '../../../../src/infrastructure/git/local-git-provider';
import type { GitProviderRegistry } from '../../../../src/application/ports/git-provider.port';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import type { HandoffRepository } from '../../../../src/application/ports/handoff-repository.port';
import type { AgentAutonomyRepository } from '../../../../src/application/ports/agent-autonomy-repository.port';
import type { ActivateAgentUseCase } from '../../../../src/application/use-cases/agents/activate-agent.use-case';

/**
 * As DUAS portas do provisionamento, juntas, contra o banco e o git de
 * verdade (RN-582, ADR 0165).
 *
 * O aceite ao Arquiteto é o gatilho; o aceite ao Dev Lead ficou como segunda
 * porta. A decisão de mantê-la só se sustenta se ela for de graça num projeto
 * que já provisionou — e "de graça" aqui é medido no que o `LocalGitProvider`
 * recebe e no que as tabelas guardam, não num fake que devolve `{}`. O caso de
 * uso de provisionamento já tinha a prova de três rodadas seguidas; o que esta
 * suíte acrescenta é a prova PELO CAMINHO REAL: dois aceites, um repositório.
 */
const { db, pool } = createTestDb();

const unitOfWork = new DrizzleUnitOfWork(db);
const repositories = new DrizzleProvisionedRepositoryRepository(db);
const repoBootstraps = new DrizzleRepoBootstrapRepository(db);
const outbox = new DrizzleOutboxRepository(db);
const sessionRepo = new DrizzleSessionRepository(db);
const appendSessionEvent = new AppendSessionEventUseCase(
  unitOfWork,
  sessionRepo,
  new DrizzleSessionEventRepository(db),
  outbox,
);

// O bootstrap nunca aciona o engine (ADR 0005): só transiciona a própria
// sessão para `closing`/`closed`, e isso não passa pelo cliente.
const engineQueNaoDeveriaSerChamado = new Proxy(
  {},
  {
    get: () => () => {
      throw new Error('engine não deveria ser chamado pelo provisionamento');
    },
  },
) as ApiToEngineClient;

class ProviderContado implements GitProviderContract {
  readonly chamadas: Record<string, number> = {};
  constructor(private readonly inner: GitProviderContract) {}
  get name() {
    return this.inner.name;
  }
  get capabilities() {
    return this.inner.capabilities;
  }
  private conta<T>(m: string, fn: () => Promise<T>): Promise<T> {
    this.chamadas[m] = (this.chamadas[m] ?? 0) + 1;
    return fn();
  }
  createRepo: GitProviderContract['createRepo'] = (i) =>
    this.conta('createRepo', () => this.inner.createRepo(i));
  getRepo: GitProviderContract['getRepo'] = (i) =>
    this.conta('getRepo', () => this.inner.getRepo(i));
  createBranch: GitProviderContract['createBranch'] = (i) =>
    this.conta('createBranch', () => this.inner.createBranch(i));
  protectBranch: GitProviderContract['protectBranch'] = (i) =>
    this.conta('protectBranch', () => this.inner.protectBranch(i));
  commitFiles: GitProviderContract['commitFiles'] = (i) =>
    this.conta('commitFiles', () => this.inner.commitFiles(i));
  listBranches: GitProviderContract['listBranches'] = (i) =>
    this.conta('listBranches', () => this.inner.listBranches(i));
  openPullRequest: GitProviderContract['openPullRequest'] = (i) =>
    this.conta('openPullRequest', () => this.inner.openPullRequest(i));
  mergePullRequest: GitProviderContract['mergePullRequest'] = (i) =>
    this.conta('mergePullRequest', () => this.inner.mergePullRequest(i));
  getFileContent: GitProviderContract['getFileContent'] = (i) =>
    this.conta('getFileContent', () => this.inner.getFileContent(i));
  commentOnPullRequest: GitProviderContract['commentOnPullRequest'] = (i) =>
    this.conta('commentOnPullRequest', () =>
      this.inner.commentOnPullRequest(i),
    );
  listTree: GitProviderContract['listTree'] = (i) =>
    this.conta('listTree', () => this.inner.listTree(i));
  getPullRequestDiff: GitProviderContract['getPullRequestDiff'] = (i) =>
    this.conta('getPullRequestDiff', () => this.inner.getPullRequestDiff(i));
}

// Os handoffs ficam em memória: o que esta suíte mede é o provisionamento, e
// a tabela `handoffs` não participa dele.
class HandoffsEmMemoria {
  readonly linhas = new Map<
    string,
    { id: string; sessionId: string; toAgent: string; status: string }
  >();
  findById(id: string) {
    return Promise.resolve(this.linhas.get(id) ?? null);
  }
  updateStatus(id: string, status: string) {
    const linha = { ...this.linhas.get(id)!, status };
    this.linhas.set(id, linha);
    return Promise.resolve(linha);
  }
}

let repoRoot: string;

beforeEach(async () => {
  await truncateAll(db);
  repoRoot = await mkdtemp(join(tmpdir(), 'brabo-duas-portas-'));
  process.env.GIT_LOCAL_REPOS_ROOT = repoRoot;
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

afterAll(async () => {
  await pool.end();
});

async function montar() {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-duas-portas', email: 'portas@brabo.dev' })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: user.id })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: 'loja',
      slug: 'loja',
      createdBy: user.id,
    })
    .returning();

  const provider = new ProviderContado(new LocalGitProvider());
  const registry: GitProviderRegistry = { get: () => provider };
  const createSession = new CreateSessionUseCase(
    unitOfWork,
    sessionRepo,
    outbox,
  );
  const provision = new ProvisionRepositoryUseCase(
    unitOfWork,
    new DrizzleUserCredentialRepository(db),
    new EnvelopeEncryptionService(),
    registry,
    repositories,
    repoBootstraps,
    outbox,
    new DrizzleProposedActionRepository(db),
    sessionRepo,
    createSession,
    appendSessionEvent,
    new TransitionSessionUseCase(
      unitOfWork,
      sessionRepo,
      outbox,
      engineQueNaoDeveriaSerChamado,
    ),
    new BootstrapRunner(
      unitOfWork,
      repoBootstraps,
      outbox,
      new DrizzleProposedActionRepository(db),
      appendSessionEvent,
    ),
  );

  const handoffs = new HandoffsEmMemoria();
  const eventosDoAceite: string[] = [];
  const ativados: string[] = [];
  const uc = new AcceptHandoffUseCase(
    handoffs as unknown as HandoffRepository,
    { upsert: () => Promise.resolve({}) } as unknown as AgentAutonomyRepository,
    {
      execute: (_p: string, _s: string, e: { type: string }) => {
        eventosDoAceite.push(e.type);
        return Promise.resolve({});
      },
      // A sessão do aceite está aberta (RN-581 só recusa sessão encerrada).
      garantirQueAceita: () => Promise.resolve(),
    } as unknown as AppendSessionEventUseCase,
    {
      execute: (_p: string, _s: string, agente: string) => {
        ativados.push(agente);
        return Promise.resolve({});
      },
    } as unknown as ActivateAgentUseCase,
    new DrizzleProjectRepository(db),
    repositories,
    provision,
  );

  return { user, project, provider, handoffs, uc, eventosDoAceite, ativados };
}

describe('As duas portas do provisionamento (RN-582) — um repositório só', () => {
  it('aceitar o Arquiteto e depois o Dev Lead: UM createRepo, UMA linha, nenhuma falha', async () => {
    const { user, project, provider, handoffs, uc, eventosDoAceite, ativados } =
      await montar();
    handoffs.linhas.set('h-arq', {
      id: 'h-arq',
      sessionId: 's-po',
      toAgent: 'arquiteto',
      status: 'offered',
    });
    handoffs.linhas.set('h-dev', {
      id: 'h-dev',
      sessionId: 's-po',
      toAgent: 'dev-lead',
      status: 'offered',
    });

    await uc.execute(project.id, 's-po', 'h-arq', user.id);

    // O gatilho: o repositório existe ANTES do segundo aceite.
    expect(await repositories.findByProjectId(project.id)).toMatchObject({
      provider: 'local',
      origin: 'created',
    });
    const mutacoesDepoisDoArquiteto = {
      createBranch: provider.chamadas.createBranch,
      commitFiles: provider.chamadas.commitFiles,
    };

    await uc.execute(project.id, 's-po', 'h-dev', user.id);

    // A segunda porta não criou nada: nenhum repositório novo, nenhuma
    // mutação de branch/commit, nenhuma sessão de bootstrap a mais.
    expect(provider.chamadas.createRepo).toBe(1);
    expect(provider.chamadas.createBranch).toBe(
      mutacoesDepoisDoArquiteto.createBranch,
    );
    expect(provider.chamadas.commitFiles).toBe(
      mutacoesDepoisDoArquiteto.commitFiles,
    );
    const linhasDeRepo = await db
      .select()
      .from(projectRepositories)
      .where(eq(projectRepositories.projectId, project.id));
    expect(linhasDeRepo).toHaveLength(1);
    const linhasDeBootstrap = await db
      .select()
      .from(repoBootstrapsTable)
      .where(eq(repoBootstrapsTable.projectId, project.id));
    expect(linhasDeBootstrap).toHaveLength(1);
    expect(linhasDeBootstrap[0].status).toBe('done');
    const sessoesDeBootstrap = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.projectId, project.id));
    expect(sessoesDeBootstrap).toHaveLength(1);

    // E nenhum dos dois aceites registrou falha.
    expect(eventosDoAceite).toEqual(['handoff.accepted', 'handoff.accepted']);
    expect(ativados).toEqual(['arquiteto', 'dev-lead']);
  });

  it('o exp001: Arquiteto aceito SEM repositório, e a segunda porta provisiona', async () => {
    // O estado da AT-092, reproduzido: o handoff ao Arquiteto já está
    // `accepted` (foi aceito sob a regra velha, que não provisionava ali), e o
    // do Dev Lead segue `offered`. Nenhuma linha de git.
    const { user, project, provider, handoffs, uc, eventosDoAceite } =
      await montar();
    handoffs.linhas.set('h-dev', {
      id: 'h-dev',
      sessionId: 's-po',
      toAgent: 'dev-lead',
      status: 'offered',
    });
    expect(await repositories.findByProjectId(project.id)).toBeNull();

    await uc.execute(project.id, 's-po', 'h-dev', user.id);

    expect(provider.chamadas.createRepo).toBe(1);
    expect(await repositories.findByProjectId(project.id)).toMatchObject({
      origin: 'created',
    });
    expect(eventosDoAceite).toEqual(['handoff.accepted']);
  });
});
