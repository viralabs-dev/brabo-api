/**
 * Demo do critério de aceite da sessão 3 (bootstrap de Gitflow): provisiona
 * um projeto com LocalGitProvider, MATA o processo no meio do bootstrap
 * (via uma falha injetada — ver comentário abaixo sobre por que não é um
 * kill -9 de verdade), roda de nova e mostra que converge, com o event log
 * narrando os skips dos passos já feitos.
 *
 * Uso: pnpm --filter api demo:repo-bootstrap
 *
 * "Matar o processo no meio" aqui é uma falha injetada na 2ª chamada de
 * createBranch (create_qa_branch, o passo 4 de 6 na ordem de execução —
 * ver bootstrap-steps.ts) em vez de um kill -9 real num processo filho:
 * o efeito observável é idêntico (o processo atual encerra sem terminar
 * o bootstrap, a linha de repo_bootstraps fica com status=failed no
 * passo em andamento) sem a fragilidade de orquestrar supervisão de
 * processo só pra uma demo.
 */
import 'reflect-metadata';
import { rm } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../src/db/schema';
import { sessionEvents, projects, users, workspaces } from '../src/db/schema';
import { DrizzleUnitOfWork } from '../src/infrastructure/persistence/drizzle/drizzle-unit-of-work';
import { DrizzleProvisionedRepositoryRepository } from '../src/infrastructure/persistence/drizzle/provisioned-repository.repository';
import { DrizzleRepoBootstrapRepository } from '../src/infrastructure/persistence/drizzle/repo-bootstrap.repository';
import { DrizzleOutboxRepository } from '../src/infrastructure/persistence/drizzle/outbox.repository';
import { DrizzleProposedActionRepository } from '../src/infrastructure/persistence/drizzle/proposed-action.repository';
import { DrizzleSessionRepository } from '../src/infrastructure/persistence/drizzle/session.repository';
import { DrizzleSessionEventRepository } from '../src/infrastructure/persistence/drizzle/session-event.repository';
import { DrizzleUserCredentialRepository } from '../src/infrastructure/persistence/drizzle/user-credential.repository';
import { EnvelopeEncryptionService } from '../src/infrastructure/security/envelope-encryption.service';
import { AppendSessionEventUseCase } from '../src/application/use-cases/sessions/append-session-event.use-case';
import { TransitionSessionUseCase } from '../src/application/use-cases/sessions/transition-session.use-case';
import { ProvisionRepositoryUseCase } from '../src/application/use-cases/git/provision-repository.use-case';
import { LocalGitProvider } from '../src/infrastructure/git/local-git-provider';
import type { GitProviderRegistry } from '../src/application/ports/git-provider.port';
import type { ApiToEngineClient } from '../src/application/ports/api-to-engine-client.port';

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
  offerInfraHandoff(): Promise<void> {
    throw new Error('engine não deveria ser chamado pelo bootstrap');
  }
  executeTerminalAction(): Promise<never> {
    throw new Error('engine não deveria ser chamado pelo bootstrap');
  }
}

// Mesmo fake dos testes (provision-repository.use-case.spec.ts) — envolve
// um GitProviderContract real, lançando na Nª chamada de um método
// escolhido pra simular o processo morrendo no meio de uma mutação.
class FailOnceGitProvider {
  private calls = 0;
  constructor(
    private readonly inner: LocalGitProvider,
    private readonly failMethod: 'createBranch',
    private readonly failOnCallNumber: number,
  ) {}

  get name() {
    return this.inner.name;
  }
  get capabilities() {
    return this.inner.capabilities;
  }

  createBranch: LocalGitProvider['createBranch'] = async (input) => {
    this.calls += 1;
    if (
      this.failMethod === 'createBranch' &&
      this.calls === this.failOnCallNumber
    ) {
      throw new Error(
        `[demo] processo "morto" — falha injetada em createBranch (chamada ${this.calls})`,
      );
    }
    return this.inner.createBranch(input);
  };

  createRepo: LocalGitProvider['createRepo'] = (i) => this.inner.createRepo(i);
  getRepo: LocalGitProvider['getRepo'] = (i) => this.inner.getRepo(i);
  protectBranch: LocalGitProvider['protectBranch'] = () =>
    this.inner.protectBranch();
  commitFiles: LocalGitProvider['commitFiles'] = (i) =>
    this.inner.commitFiles(i);
  listBranches: LocalGitProvider['listBranches'] = (i) =>
    this.inner.listBranches(i);
  openPullRequest: LocalGitProvider['openPullRequest'] = (i) =>
    this.inner.openPullRequest(i);
  mergePullRequest: LocalGitProvider['mergePullRequest'] = (i) =>
    this.inner.mergePullRequest(i);
  getFileContent: LocalGitProvider['getFileContent'] = (i) =>
    this.inner.getFileContent(i);
  commentOnPullRequest: LocalGitProvider['commentOnPullRequest'] = (i) =>
    this.inner.commentOnPullRequest(i);
}

async function main() {
  const databaseUrl =
    process.env.DATABASE_URL ?? 'postgres://brabo:brabo@localhost:5432/brabo';
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });

  const repoRoot = await mkdtemp(join(tmpdir(), 'brabo-demo-bootstrap-'));
  process.env.GIT_LOCAL_REPOS_ROOT = repoRoot;

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
  const transitionSession = new TransitionSessionUseCase(
    unitOfWork,
    sessionRepo,
    outbox,
    new UnreachableEngineClient(),
  );

  const provider = new FailOnceGitProvider(
    new LocalGitProvider(),
    'createBranch',
    2,
  );
  const registry: GitProviderRegistry = { get: () => provider };

  const useCase = new ProvisionRepositoryUseCase(
    unitOfWork,
    userCredentials,
    encryption,
    registry,
    repositories,
    repoBootstraps,
    outbox,
    proposedActionsRepo,
    sessionRepo,
    appendSessionEvent,
    transitionSession,
  );

  const [user] = await db
    .insert(users)
    .values({
      keycloakSub: 'demo-bootstrap',
      email: 'demo-bootstrap@brabo.dev',
    })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'demo', slug: `demo-${Date.now()}`, createdBy: user.id })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: 'demo-repo-bootstrap',
      slug: `demo-repo-bootstrap-${Date.now()}`,
      createdBy: user.id,
    })
    .returning();
  console.log(`✓ projeto criado: ${project.id}`);

  console.log('\n--- 1ª execução (vai "morrer" no meio) ---');
  try {
    await useCase.execute(project.id, user.id, {
      provider: 'local',
      name: 'demo-repo',
      visibility: 'private',
    });
    console.log('inesperado: convergiu na 1ª tentativa (sem falha injetada?)');
  } catch (error) {
    console.log(
      `✓ processo "morreu": ${error instanceof Error ? error.message : error}`,
    );
  }

  const failedRow = await repoBootstraps.findByProjectId(project.id);
  console.log(
    `✓ repo_bootstraps: step=${failedRow?.step} status=${failedRow?.status} attempts=${failedRow?.attempts}`,
  );

  console.log('\n--- 2ª execução (retomada) ---');
  const result = await useCase.execute(project.id, user.id, {
    provider: 'local',
    name: 'demo-repo',
    visibility: 'private',
  });
  console.log(
    `✓ convergiu: step=${result.bootstrap.step} status=${result.bootstrap.status}`,
  );

  const events = await db
    .select()
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, failedRow!.sessionId));
  events.sort((a, b) => a.seq - b.seq);

  console.log('\n--- event log completo (as duas execuções) ---');
  for (const event of events) {
    console.log(`#${event.seq} ${event.type} ${JSON.stringify(event.payload)}`);
  }

  await rm(repoRoot, { recursive: true, force: true });
  await pool.end();
}

main().catch((error) => {
  console.error('Demo falhou:', error);
  process.exit(1);
});
