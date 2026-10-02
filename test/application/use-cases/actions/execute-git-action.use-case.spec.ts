import { describe, it, expect } from 'vitest';
import { ExecuteGitActionUseCase } from '../../../../src/application/use-cases/actions/execute-git-action.use-case';
import type { ResolveCredentialOwnerUseCase } from '../../../../src/application/use-cases/llm/resolve-credential-owner.use-case';
import type { ProposedActionRepository } from '../../../../src/application/ports/proposed-action-repository.port';
import type { OutboxRepository } from '../../../../src/application/ports/outbox-repository.port';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import type { GitProviderRegistry } from '../../../../src/application/ports/git-provider.port';
import type { ProvisionedRepositoryRepository } from '../../../../src/application/ports/provisioned-repository-repository.port';
import type { UserCredentialRepository } from '../../../../src/application/ports/user-credential-repository.port';
import type { EncryptionService } from '../../../../src/application/ports/encryption.port';
import type { TaskRepository } from '../../../../src/application/ports/backlog-repository.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { ProposedAction } from '../../../../src/domain/actions/proposed-action.entity';
import { GitMergeConflictError } from '../../../../src/domain/git/git-errors';

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
let eventos: Array<{ type: string; payload: unknown }> = [];
const append = {
  execute: (_p: string, _s: string, e: { type: string; payload: unknown }) => {
    eventos.push(e);
    return Promise.resolve({});
  },
} as unknown as AppendSessionEventUseCase;

/** Fake de `TaskRepository`: `feitas` guarda as tarefas já `done` (idempotência). */
class FakeTasks {
  feitas = new Set<string>();
  chamadas: string[] = [];
  markDoneIfNotDone(id: string) {
    this.chamadas.push(id);
    if (this.feitas.has(id)) return Promise.resolve(null);
    this.feitas.add(id);
    return Promise.resolve({ id, status: 'done' });
  }
}
let tasks: FakeTasks;
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
  prOpens: ProposedAction[] = [];
  listByProjectAndType() {
    return Promise.resolve(this.prOpens);
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
  tasks = new FakeTasks();
  eventos = [];
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
    tasks as unknown as TaskRepository,
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

  // RN-664 (AT-250): `pr_open` sem `targetBranch` (proposto antes de o dev
  // agent mandar o campo) mira `dev`, não a `defaultBranch` do repositório.
  it('pr_open sem targetBranch mira `dev`, não a defaultBranch', async () => {
    let alvo: string | undefined;
    const uc = build({
      provider: {
        openPullRequest: (input: { targetBranch: string }) => {
          alvo = input.targetBranch;
          return Promise.resolve({
            id: 'pr-2',
            number: 2,
            url: 'local://repo/pull/2',
            sourceBranch: 'feature/x',
            targetBranch: input.targetBranch,
            state: 'open',
          });
        },
      },
    });
    await uc.execute(
      PROJECT,
      SESSION,
      action('pr_open', { sourceBranch: 'feature/x', title: 'X' }),
    );
    expect(alvo).toBe('dev');
    expect(proposedActions.saved?.result).toMatchObject({
      kind: 'pr_open',
      targetBranch: 'dev',
    });
  });

  it('pr_open com targetBranch explícito respeita o campo', async () => {
    let alvo: string | undefined;
    const uc = build({
      provider: {
        openPullRequest: (input: { targetBranch: string }) => {
          alvo = input.targetBranch;
          return Promise.resolve({
            id: 'pr-3',
            number: 3,
            url: 'local://repo/pull/3',
            sourceBranch: 'feature/x',
            targetBranch: input.targetBranch,
            state: 'open',
          });
        },
      },
    });
    await uc.execute(
      PROJECT,
      SESSION,
      action('pr_open', {
        sourceBranch: 'feature/x',
        targetBranch: 'dev',
        title: 'X',
      }),
    );
    expect(alvo).toBe('dev');
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

  // --- AT-275 (RN-628): o merge executado fecha a tarefa ---------------------
  describe('git_merge marca a tarefa como done', () => {
    function prOpenDaTarefa(taskId: string, pullRequestId: string) {
      const a = action('pr_open', { storyTaskId: taskId });
      a.executionResult = {
        kind: 'pr_open',
        pullRequestUrl: 'local://x',
        pullRequestId,
        sourceBranch: 'feature/x',
        targetBranch: 'dev',
      };
      return a;
    }
    const merge = (state = 'merged') => ({
      mergePullRequest: () =>
        Promise.resolve({ id: 'pr-6', state, targetBranch: 'dev' }),
    });

    it('marca done a tarefa cuja PR foi mergeada e grava UM evento imutável', async () => {
      const uc = build({ provider: merge() });
      proposedActions.prOpens = [
        prOpenDaTarefa('t1', 'pr-6'),
        prOpenDaTarefa('t2', 'pr-7'),
      ];

      await uc.execute(
        PROJECT,
        SESSION,
        action('git_merge', { pullRequestId: 'pr-6' }),
      );

      expect(tasks.chamadas).toEqual(['t1']);
      const evs = eventos.filter(
        (e) => e.type === 'backlog.task_status_changed',
      );
      expect(evs).toHaveLength(1);
      expect(evs[0].payload).toMatchObject({
        taskId: 't1',
        status: 'done',
        cause: 'pr_merged',
      });
    });

    it('merge repetido da mesma PR não move de novo nem duplica evento', async () => {
      const uc = build({ provider: merge() });
      proposedActions.prOpens = [prOpenDaTarefa('t1', 'pr-6')];

      await uc.execute(
        PROJECT,
        SESSION,
        action('git_merge', { pullRequestId: 'pr-6' }),
      );
      await uc.execute(
        PROJECT,
        SESSION,
        action('git_merge', { pullRequestId: 'pr-6' }),
      );

      expect(tasks.chamadas).toEqual(['t1', 't1']);
      expect(
        eventos.filter((e) => e.type === 'backlog.task_status_changed'),
      ).toHaveLength(1);
    });

    it('PR que não terminou `merged`, ou merge que falhou, não toca a tarefa', async () => {
      const aberta = build({ provider: merge('open') });
      proposedActions.prOpens = [prOpenDaTarefa('t1', 'pr-6')];
      await aberta.execute(
        PROJECT,
        SESSION,
        action('git_merge', { pullRequestId: 'pr-6' }),
      );
      expect(tasks.chamadas).toEqual([]);

      const falha = build({
        provider: {
          mergePullRequest: () => Promise.reject(new Error('conflito')),
        },
      });
      proposedActions.prOpens = [prOpenDaTarefa('t1', 'pr-6')];
      await falha.execute(
        PROJECT,
        SESSION,
        action('git_merge', { pullRequestId: 'pr-6' }),
      );
      expect(proposedActions.saved?.status).toBe('failed');
      expect(tasks.chamadas).toEqual([]);
    });

    it('PR sem tarefa (infra/ADR) não muda nada', async () => {
      const uc = build({ provider: merge() });
      proposedActions.prOpens = [];
      await uc.execute(
        PROJECT,
        SESSION,
        action('git_merge', { pullRequestId: 'pr-6' }),
      );
      expect(proposedActions.saved?.status).toBe('executed');
      expect(tasks.chamadas).toEqual([]);
    });
  });

  describe('RN-705: a falha grava o kind da AÇÃO e o conflito vira evento', () => {
    it('conflito de merge → kind git_merge, arquivos no resultado e evento na tarefa', async () => {
      const uc = build({
        provider: {
          mergePullRequest: () =>
            Promise.reject(
              new GitMergeConflictError('/tmp/repo', 'pr-6', ['package.json']),
            ),
        },
      });
      const pr = action('pr_open', { storyTaskId: 't1' });
      pr.executionResult = {
        kind: 'pr_open',
        pullRequestUrl: 'local://x',
        pullRequestId: 'pr-6',
        sourceBranch: 'feature/x',
        targetBranch: 'dev',
      };
      proposedActions.prOpens = [pr];
      await uc.execute(
        PROJECT,
        SESSION,
        action('git_merge', { pullRequestId: 'pr-6' }),
      );
      expect(proposedActions.saved?.status).toBe('failed');
      expect(proposedActions.saved?.result).toMatchObject({
        kind: 'git_merge',
        failed: true,
        pullRequestId: 'pr-6',
        conflictingFiles: ['package.json'],
      });
      const evs = eventos.filter(
        (e) => e.type === 'backlog.task_merge_conflict',
      );
      expect(evs).toHaveLength(1);
      expect(evs[0].payload).toMatchObject({
        taskId: 't1',
        conflictingFiles: ['package.json'],
      });
    });

    it('falha que não é conflito não grava arquivos nem evento de conflito', async () => {
      const uc = build({
        provider: {
          mergePullRequest: () => Promise.reject(new Error('rede fora')),
        },
      });
      await uc.execute(
        PROJECT,
        SESSION,
        action('git_merge', { pullRequestId: 'pr-6' }),
      );
      expect(proposedActions.saved?.result).toEqual({
        kind: 'git_merge',
        failed: true,
        error: 'rede fora',
        pullRequestId: 'pr-6',
      });
      expect(
        eventos.some((e) => e.type === 'backlog.task_merge_conflict'),
      ).toBe(false);
    });
  });
});
