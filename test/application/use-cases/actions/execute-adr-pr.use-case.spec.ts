import { describe, it, expect, beforeEach } from 'vitest';
import { ExecuteAdrPrUseCase } from '../../../../src/application/use-cases/actions/execute-adr-pr.use-case';
import type { ProposedActionRepository } from '../../../../src/application/ports/proposed-action-repository.port';
import type { OutboxRepository } from '../../../../src/application/ports/outbox-repository.port';
import type { GitProviderRegistry } from '../../../../src/application/ports/git-provider.port';
import type { ProvisionedRepositoryRepository } from '../../../../src/application/ports/provisioned-repository-repository.port';
import type { UserCredentialRepository } from '../../../../src/application/ports/user-credential-repository.port';
import type { EncryptionService } from '../../../../src/application/ports/encryption.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { ProposedAction } from '../../../../src/domain/actions/proposed-action.entity';

const PROJECT = 'p1';
const SESSION = 's1';

function adrAction(): ProposedAction {
  return {
    id: 'act-1',
    projectId: PROJECT,
    sessionId: SESSION,
    seq: 1,
    actionType: 'open_adr_pr',
    payload: {
      title: 'Usar Postgres',
      slug: '0001-usar-postgres',
      content: '# ADR',
    },
    status: 'approved',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'agent', id: 'arquiteto' },
    decidedBy: 'user-1',
    decidedAt: new Date(),
    rejectionReason: null,
    executionResult: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

class FakeProvider {
  name = 'local';
  calls: string[] = [];
  createBranch(input: { branchName: string }) {
    this.calls.push(`branch:${input.branchName}`);
    return Promise.resolve({ name: input.branchName });
  }
  commitFiles(input: { files: { path: string }[] }) {
    this.calls.push(`commit:${input.files[0].path}`);
    return Promise.resolve({ sha: 'abc', branch: 'x' });
  }
  openPullRequest() {
    this.calls.push('pr');
    return Promise.resolve({
      id: 42,
      number: 7,
      url: 'https://git.local/pr/7',
      sourceBranch: 'feature/adr-0001-usar-postgres',
      targetBranch: 'main',
      state: 'open',
    });
  }
}

class FakeProposedActions {
  saved: { status: string; result: unknown } | null = null;
  updateExecutionResult(
    _id: string,
    input: { status: string; executionResult: unknown },
  ) {
    this.saved = { status: input.status, result: input.executionResult };
    return Promise.resolve(adrAction());
  }
}

const unitOfWork = {
  runInTransaction: <T>(fn: () => Promise<T>) => fn(),
};
const outbox = {
  append: () => Promise.resolve(),
} as unknown as OutboxRepository;
const append = {
  execute: () => Promise.resolve({}),
} as unknown as AppendSessionEventUseCase;
const repositories = {
  findByProjectId: () =>
    Promise.resolve({
      provider: 'local',
      externalId: '/tmp/repo',
      defaultBranch: 'main',
    }),
} as unknown as ProvisionedRepositoryRepository;
const userCredentials = {} as unknown as UserCredentialRepository;
const encryption = {} as unknown as EncryptionService;

let provider: FakeProvider;
let proposedActions: FakeProposedActions;
let useCase: ExecuteAdrPrUseCase;

beforeEach(() => {
  provider = new FakeProvider();
  proposedActions = new FakeProposedActions();
  const gitProviders = {
    get: () => provider,
  } as unknown as GitProviderRegistry;
  useCase = new ExecuteAdrPrUseCase(
    unitOfWork,
    proposedActions as unknown as ProposedActionRepository,
    append,
    outbox,
    gitProviders,
    repositories,
    userCredentials,
    encryption,
  );
});

describe('ExecuteAdrPrUseCase', () => {
  it('cria branch feature/adr-*, commita o ADR e abre a PR (executionResult com url)', async () => {
    await useCase.execute(PROJECT, SESSION, adrAction());

    expect(provider.calls).toEqual([
      'branch:feature/adr-0001-usar-postgres',
      'commit:docs/adr/0001-usar-postgres.md',
      'pr',
    ]);
    expect(proposedActions.saved?.status).toBe('executed');
    expect(proposedActions.saved?.result).toMatchObject({
      pullRequestUrl: 'https://git.local/pr/7',
      branch: 'feature/adr-0001-usar-postgres',
      path: 'docs/adr/0001-usar-postgres.md',
    });
  });

  it('sem repositório provisionado → failed (não estoura)', async () => {
    const noRepo = {
      findByProjectId: () => Promise.resolve(null),
    } as unknown as ProvisionedRepositoryRepository;
    const uc = new ExecuteAdrPrUseCase(
      unitOfWork,
      proposedActions as unknown as ProposedActionRepository,
      append,
      outbox,
      { get: () => provider } as unknown as GitProviderRegistry,
      noRepo,
      userCredentials,
      encryption,
    );
    await uc.execute(PROJECT, SESSION, adrAction());
    expect(proposedActions.saved?.status).toBe('failed');
    expect(provider.calls).toEqual([]);
  });
});
