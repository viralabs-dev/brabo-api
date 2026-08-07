import { describe, it, expect, beforeEach } from 'vitest';
import { ExecuteGitActionUseCase } from '../../../../src/application/use-cases/actions/execute-git-action.use-case';
import type { ResolveCredentialOwnerUseCase } from '../../../../src/application/use-cases/llm/resolve-credential-owner.use-case';
import type { ProposedActionRepository } from '../../../../src/application/ports/proposed-action-repository.port';
import type { OutboxRepository } from '../../../../src/application/ports/outbox-repository.port';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import type { GitProviderRegistry } from '../../../../src/application/ports/git-provider.port';
import type { ProvisionedRepositoryRepository } from '../../../../src/application/ports/provisioned-repository-repository.port';
import type { UserCredentialRepository } from '../../../../src/application/ports/user-credential-repository.port';
import type { EncryptionService } from '../../../../src/application/ports/encryption.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { ProposedAction } from '../../../../src/domain/actions/proposed-action.entity';

const PROJECT = 'p1';
const SESSION = 's1';

function action(
  actionType: ProposedAction['actionType'],
  payload: Record<string, unknown>,
): ProposedAction {
  return {
    id: 'act-1',
    projectId: PROJECT,
    sessionId: SESSION,
    seq: 1,
    actionType,
    payload,
    status: 'approved',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'agent', id: 'dev-api' },
    decidedBy: null,
    decidedAt: new Date(),
    rejectionReason: null,
    executionResult: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const unitOfWork = {
  runInTransaction: <T>(fn: () => Promise<T>) => fn(),
} as never;
const outbox = {
  append: () => Promise.resolve(),
} as unknown as OutboxRepository;
const append = {
  execute: () => Promise.resolve({}),
} as unknown as AppendSessionEventUseCase;
const userCredentials = {} as unknown as UserCredentialRepository;
const encryption = {} as unknown as EncryptionService;

/** Registra POR QUEM a credencial foi pedida — é o que o achado AA errava. */
class FakeCredenciais {
  pedidaPara: string | null = null;
  findSecretByUserAndProvider(userId: string) {
    this.pedidaPara = userId;
    return Promise.resolve('cifrado');
  }
}

const OWNER = 'owner-do-workspace';

class FakeProposedActions {
  saved: { status: string; result: unknown } | null = null;
  updateExecutionResult(
    _id: string,
    input: { status: string; executionResult: unknown },
  ) {
    this.saved = { status: input.status, result: input.executionResult };
    return Promise.resolve(action('git_commit', {}));
  }
}

let proposedActions: FakeProposedActions;

function build(overrides: {
  engine?: Partial<ApiToEngineClient>;
  provider?: Record<string, unknown>;
  repo?: unknown;
  credenciais?: FakeCredenciais;
}) {
  proposedActions = new FakeProposedActions();
  return new ExecuteGitActionUseCase(
    unitOfWork,
    proposedActions as unknown as ProposedActionRepository,
    append,
    outbox,
    (overrides.engine ?? {}) as unknown as ApiToEngineClient,
    { get: () => overrides.provider } as unknown as GitProviderRegistry,
    {
      findByProjectId: () =>
        Promise.resolve(
          overrides.repo ?? {
            provider: 'local',
            externalId: '/tmp/repo',
            defaultBranch: 'main',
          },
        ),
    } as unknown as ProvisionedRepositoryRepository,
    overrides.credenciais ?? userCredentials,
    overrides.credenciais
      ? ({ decrypt: () => 'token-do-owner' } as unknown as EncryptionService)
      : encryption,
    {
      execute: () => Promise.resolve(OWNER),
    } as unknown as ResolveCredentialOwnerUseCase,
  );
}

describe('ExecuteGitActionUseCase', () => {
  it('git_commit → executa no engine e grava sha/branch', async () => {
    const uc = build({
      engine: {
        executeGitAction: () =>
          Promise.resolve({ sha: 'abc123', branch: 'feature/x' }),
      },
    });
    await uc.execute(PROJECT, SESSION, action('git_commit', {}));
    expect(proposedActions.saved?.status).toBe('executed');
    expect(proposedActions.saved?.result).toMatchObject({
      kind: 'git_commit',
      sha: 'abc123',
      branch: 'feature/x',
    });
  });

  it('pr_open → abre a PR via provider e grava url', async () => {
    const uc = build({
      provider: {
        openPullRequest: () =>
          Promise.resolve({
            id: 'pr-1',
            number: 1,
            url: 'local://repo/pull/1',
            sourceBranch: 'feature/x',
            targetBranch: 'main',
            state: 'open',
          }),
      },
    });
    await uc.execute(
      PROJECT,
      SESSION,
      action('pr_open', {
        sourceBranch: 'feature/x',
        targetBranch: 'main',
        title: 'X',
      }),
    );
    expect(proposedActions.saved?.status).toBe('executed');
    expect(proposedActions.saved?.result).toMatchObject({
      kind: 'pr_open',
      pullRequestUrl: 'local://repo/pull/1',
    });
  });

  it('sem repositório provisionado → failed (não estoura)', async () => {
    const uc = build({ provider: {}, repo: null });
    await uc.execute(PROJECT, SESSION, action('pr_open', {}));
    expect(proposedActions.saved?.status).toBe('failed');
  });

  // --- achado AA da FASE 13b -------------------------------------------
  //
  // A credencial vinha de `action.decidedBy`. Ação AUTO-APROVADA não tem
  // decisor: o campo fica NULL, o token fica undefined, e o GitHub responde
  // `Requires authentication`. Com autonomia ligada, nenhum dev agent
  // conseguia abrir PR em provider remoto.
  it('pr_open auto-aprovado usa a credencial do OWNER, não a de quem decidiu', async () => {
    const credenciais = new FakeCredenciais();
    let tokenRecebido: string | undefined;

    const uc = build({
      credenciais,
      repo: {
        provider: 'github',
        externalId: 'dono/repo',
        defaultBranch: 'main',
      },
      provider: {
        openPullRequest: (input: { accessToken?: string }) => {
          tokenRecebido = input.accessToken;
          return Promise.resolve({
            url: 'https://github.com/dono/repo/pull/1',
            id: '1',
            sourceBranch: 'feature/x',
            targetBranch: 'main',
          });
        },
      },
    });

    // `decidedBy: null` é o estado de toda ação auto-aprovada.
    await uc.execute(PROJECT, SESSION, action('pr_open', {}));

    expect(credenciais.pedidaPara).toBe(OWNER);
    expect(tokenRecebido).toBe('token-do-owner');
    expect(proposedActions.saved?.status).toBe('executed');
  });
});
