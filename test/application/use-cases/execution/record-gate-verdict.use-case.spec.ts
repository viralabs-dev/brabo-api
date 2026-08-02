import { describe, it, expect, vi } from 'vitest';
import { RecordGateVerdictUseCase } from '../../../../src/application/use-cases/execution/record-gate-verdict.use-case';
import type { MarkTaskBlockedUseCase } from '../../../../src/application/use-cases/execution/mark-task-blocked.use-case';
import type { TaskRepository } from '../../../../src/application/ports/backlog-repository.port';
import type { ProposedActionRepository } from '../../../../src/application/ports/proposed-action-repository.port';
import type { ProvisionedRepositoryRepository } from '../../../../src/application/ports/provisioned-repository-repository.port';
import type { GitProviderRegistry } from '../../../../src/application/ports/git-provider.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { OutboxRepository } from '../../../../src/application/ports/outbox-repository.port';
import type { Task } from '../../../../src/domain/backlog/backlog.entity';
import type { ProposedAction } from '../../../../src/domain/actions/proposed-action.entity';
import type { ProvisionedRepository } from '../../../../src/domain/git/provisioned-repository.entity';

const now = new Date();

function buildTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    storyId: 'story-1',
    title: 'task',
    description: '',
    status: 'in_review',
    // Um task com gate aberto sempre tem dono no mundo real — default
    // realista pra os testes de emissão de outbox (Fase 12b) não
    // precisarem sobrescrever em todo teste.
    assignedTo: 'dev-api',
    blocked: false,
    blockedReason: null,
    blockedOrigin: null,
    gateStatus: 'awaiting_qa',
    gateCorrectionCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildPrAction(
  overrides: Partial<ProposedAction> = {},
): ProposedAction {
  return {
    id: 'action-1',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    seq: 1,
    actionType: 'pr_open',
    payload: { storyTaskId: 'task-1' },
    status: 'executed',
    resolvedPolicy: 'auto_approve',
    actor: { kind: 'agent', id: 'dev-api' },
    decidedBy: null,
    decidedAt: null,
    rejectionReason: null,
    executionResult: {
      kind: 'pr_open',
      pullRequestUrl: 'local://repo/pull/1',
      pullRequestId: 'pr-1',
      sourceBranch: 'feature/x',
      targetBranch: 'main',
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildHarness(opts: {
  task?: Task | null;
  prAction?: ProposedAction | null;
  repo?: ProvisionedRepository | null;
}) {
  const task = opts.task === undefined ? buildTask() : opts.task;
  const prAction =
    opts.prAction === undefined ? buildPrAction() : opts.prAction;
  const repo =
    opts.repo === undefined
      ? ({
          id: 'repo-1',
          projectId: 'proj-1',
          provider: 'local',
          externalId: '/tmp/repo.git',
          url: 'file:///tmp/repo.git',
          defaultBranch: 'main',
          visibility: 'private',
          provisionedBy: 'user-1',
          createdAt: now,
          updatedAt: now,
        } as ProvisionedRepository)
      : opts.repo;

  const updateGateStatus = vi.fn(
    (id: string, gateStatus: Task['gateStatus'], correctionCount: number) =>
      Promise.resolve({
        ...(task as Task),
        gateStatus,
        gateCorrectionCount: correctionCount,
      }),
  );

  const tasks = {
    findById: () => Promise.resolve(task),
    updateGateStatus,
  } as unknown as TaskRepository;

  const commentOnPullRequest = vi.fn(() => Promise.resolve());
  const proposedActions = {
    listByProjectAndType: () => Promise.resolve(prAction ? [prAction] : []),
  } as unknown as ProposedActionRepository;

  const repositories = {
    findByProjectId: () => Promise.resolve(repo),
  } as unknown as ProvisionedRepositoryRepository;

  const gitProviders = {
    get: () => ({ commentOnPullRequest }),
  } as unknown as GitProviderRegistry;

  const appendEvent = {
    execute: vi.fn(() => Promise.resolve({})),
  } as unknown as AppendSessionEventUseCase;

  const markTaskBlockedExecute = vi.fn(() =>
    // O bloqueio real zera assignedTo (backlog.repository.ts) — o mock
    // reflete isso pra provar que o outbox usa o valor CAPTURADO antes da
    // mutação, não o que markTaskBlocked devolve.
    Promise.resolve({
      ...(task as Task),
      status: 'todo',
      blocked: true,
      assignedTo: null,
    }),
  );
  const markTaskBlocked = {
    execute: markTaskBlockedExecute,
  } as unknown as MarkTaskBlockedUseCase;

  const outboxAppend = vi.fn(() => Promise.resolve());
  const outbox = { append: outboxAppend } as unknown as OutboxRepository;

  const useCase = new RecordGateVerdictUseCase(
    tasks,
    proposedActions,
    repositories,
    gitProviders,
    appendEvent,
    markTaskBlocked,
    outbox,
  );

  return {
    useCase,
    updateGateStatus,
    commentOnPullRequest,
    markTaskBlockedExecute,
    appendEvent,
    outboxAppend,
  };
}

describe('RecordGateVerdictUseCase', () => {
  it('QA aprovado: avança pro secops, comenta a PR', async () => {
    const { useCase, updateGateStatus, commentOnPullRequest } = buildHarness(
      {},
    );

    const result = await useCase.execute('proj-1', 'sess-1', {
      taskId: 'task-1',
      gate: 'qa',
      veredito: 'approved',
      resumo: 'suite verde, cobertura completa',
      itens: [],
    });

    expect(result.nextAction).toBe('run_secops');
    expect(updateGateStatus).toHaveBeenCalledWith(
      'task-1',
      'awaiting_secops',
      0,
    );
    expect(commentOnPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ pullRequestId: 'pr-1' }),
    );
  });

  it('SecOps aprovado: chega em awaiting_user, nextAction done', async () => {
    const { useCase } = buildHarness({
      task: buildTask({ gateStatus: 'awaiting_secops' }),
    });

    const result = await useCase.execute('proj-1', 'sess-1', {
      taskId: 'task-1',
      gate: 'secops',
      veredito: 'approved',
      resumo: 'nenhum achado',
      itens: [],
    });

    expect(result.nextAction).toBe('done');
    expect(result.task.gateStatus).toBe('awaiting_user');
  });

  it('changes_requested sob o teto: nextAction correct, gate mantido', async () => {
    const { useCase, updateGateStatus } = buildHarness({});

    const result = await useCase.execute(
      'proj-1',
      'sess-1',
      {
        taskId: 'task-1',
        gate: 'qa',
        veredito: 'changes_requested',
        resumo: 'regra sem teste',
        itens: ['regra X sem cobertura'],
      },
      3,
    );

    expect(result.nextAction).toBe('correct');
    expect(updateGateStatus).toHaveBeenCalledWith('task-1', 'awaiting_qa', 1);
  });

  it('changes_requested estourando o teto: bloqueia via MarkTaskBlockedUseCase', async () => {
    const { useCase, markTaskBlockedExecute, updateGateStatus } = buildHarness({
      task: buildTask({ gateCorrectionCount: 3 }),
    });

    const result = await useCase.execute(
      'proj-1',
      'sess-1',
      {
        taskId: 'task-1',
        gate: 'qa',
        veredito: 'changes_requested',
        resumo: 'ainda falhando',
        itens: ['x'],
      },
      3,
    );

    expect(result.nextAction).toBe('blocked');
    expect(markTaskBlockedExecute).toHaveBeenCalledWith(
      'proj-1',
      'sess-1',
      'task-1',
      'ciclo de correção esgotado (gate)',
      'ainda falhando',
      'qa-agent',
    );
    expect(updateGateStatus).not.toHaveBeenCalled();
  });

  it('falha ao comentar na PR não impede a decisão do gate (best-effort)', async () => {
    const { useCase } = buildHarness({ repo: null });

    const result = await useCase.execute('proj-1', 'sess-1', {
      taskId: 'task-1',
      gate: 'qa',
      veredito: 'approved',
      resumo: 'ok',
      itens: [],
    });

    expect(result.nextAction).toBe('run_secops');
  });

  describe('outbox task.gate_resolved (Fase 12b — RN-047)', () => {
    it('nextAction done: emite outbox com o agentId da task', async () => {
      const { useCase, outboxAppend } = buildHarness({
        task: buildTask({ gateStatus: 'awaiting_secops' }),
      });

      await useCase.execute('proj-1', 'sess-1', {
        taskId: 'task-1',
        gate: 'secops',
        veredito: 'approved',
        resumo: 'nenhum achado',
        itens: [],
      });

      expect(outboxAppend).toHaveBeenCalledWith({
        aggregateType: 'task',
        aggregateId: 'task-1',
        eventType: 'task.gate_resolved',
        payload: {
          projectId: 'proj-1',
          sessionId: 'sess-1',
          taskId: 'task-1',
          agentId: 'dev-api',
          gate: 'secops',
          veredito: 'approved',
          nextAction: 'done',
        },
      });
    });

    it('nextAction blocked: emite outbox com o agentId CAPTURADO antes do bloqueio zerar assignedTo', async () => {
      const { useCase, outboxAppend, markTaskBlockedExecute } = buildHarness({
        task: buildTask({ gateCorrectionCount: 3, assignedTo: 'dev-api' }),
      });

      await useCase.execute(
        'proj-1',
        'sess-1',
        {
          taskId: 'task-1',
          gate: 'qa',
          veredito: 'changes_requested',
          resumo: 'ainda falhando',
          itens: ['x'],
        },
        3,
      );

      // O mock de markTaskBlocked devolve assignedTo: null (como o real) —
      // se o outbox lesse dali, agentId viria nulo.
      expect(markTaskBlockedExecute).toHaveBeenCalled();
      expect(outboxAppend).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'task.gate_resolved',
          payload: expect.objectContaining({
            agentId: 'dev-api',
            nextAction: 'blocked',
          }),
        }),
      );
    });

    it('nextAction correct (changes_requested sob o teto): NÃO emite outbox', async () => {
      // Prova mecânica do requisito 4: o caminho de correção continua
      // tratado em processo pelo engine (QaLeadServer/SecOpsAgentServer),
      // sem outbox — não existe linha para ele acionar duas vezes.
      const { useCase, outboxAppend } = buildHarness({});

      await useCase.execute(
        'proj-1',
        'sess-1',
        {
          taskId: 'task-1',
          gate: 'qa',
          veredito: 'changes_requested',
          resumo: 'regra sem teste',
          itens: ['regra X sem cobertura'],
        },
        3,
      );

      expect(outboxAppend).not.toHaveBeenCalled();
    });

    it('nextAction run_secops (QA aprovado): NÃO emite outbox — não é desfecho terminal', async () => {
      const { useCase, outboxAppend } = buildHarness({});

      await useCase.execute('proj-1', 'sess-1', {
        taskId: 'task-1',
        gate: 'qa',
        veredito: 'approved',
        resumo: 'suite verde',
        itens: [],
      });

      expect(outboxAppend).not.toHaveBeenCalled();
    });

    it('task sem assignedTo: não emite outbox (nada pra acordar)', async () => {
      const { useCase, outboxAppend } = buildHarness({
        task: buildTask({ gateStatus: 'awaiting_secops', assignedTo: null }),
      });

      await useCase.execute('proj-1', 'sess-1', {
        taskId: 'task-1',
        gate: 'secops',
        veredito: 'approved',
        resumo: 'ok',
        itens: [],
      });

      expect(outboxAppend).not.toHaveBeenCalled();
    });
  });
});
