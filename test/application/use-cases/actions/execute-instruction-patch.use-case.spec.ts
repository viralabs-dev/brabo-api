import { describe, it, expect, vi } from 'vitest';
import { ExecuteInstructionPatchUseCase } from '../../../../src/application/use-cases/actions/execute-instruction-patch.use-case';
import type { UnitOfWork } from '../../../../src/application/ports/unit-of-work.port';
import type { ProposedActionRepository } from '../../../../src/application/ports/proposed-action-repository.port';
import type { OutboxRepository } from '../../../../src/application/ports/outbox-repository.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { ApplyInstructionVersionService } from '../../../../src/application/use-cases/instructions/apply-instruction-version.service';
import type { ProposedAction } from '../../../../src/domain/actions/proposed-action.entity';

const now = new Date();

function buildAction(payload: Record<string, unknown> = {}): ProposedAction {
  return {
    id: 'act-1',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    seq: 1,
    actionType: 'instruction_patch',
    payload: {
      agent: 'dev-api',
      fromVersion: 2,
      proposedContent: 'Você é o dev-api.\nAssuma familiaridade com NestJS.\n',
      rationale: 'usuário é sênior em NestJS',
      hypothesisId: 'hyp-7',
      ...payload,
    },
    status: 'approved',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'agent', id: 'anamnese' },
    decidedBy: 'user-9',
    decidedAt: now,
    rejectionReason: null,
    executionResult: null,
    createdAt: now,
    updatedAt: now,
  };
}

function buildHarness(
  opts: {
    changed?: boolean;
    applyThrows?: Error;
    cacheInvalidated?: boolean;
  } = {},
) {
  const unitOfWork = {
    runInTransaction: (work: () => Promise<unknown>) => work(),
  } as unknown as UnitOfWork;

  const apply = vi.fn(() => {
    if (opts.applyThrows) return Promise.reject(opts.applyThrows);
    return Promise.resolve({
      changed: opts.changed ?? true,
      fromVersion: 2,
      toVersion: 3,
      versionId: 'ver-3',
      cacheInvalidated: opts.cacheInvalidated ?? true,
    });
  });
  const applyInstruction = {
    apply,
  } as unknown as ApplyInstructionVersionService;

  const updateExecutionResult = vi.fn(
    (actionId: string, input: Record<string, unknown>) =>
      Promise.resolve({ ...buildAction(), id: actionId, ...input }),
  );
  const proposedActions = {
    updateExecutionResult,
  } as unknown as ProposedActionRepository;

  const appendEvent = vi.fn(() => Promise.resolve({}));
  const appendSessionEvent = {
    execute: appendEvent,
  } as unknown as AppendSessionEventUseCase;

  const outboxAppend = vi.fn(() => Promise.resolve({}));
  const outbox = { append: outboxAppend } as unknown as OutboxRepository;

  return {
    useCase: new ExecuteInstructionPatchUseCase(
      unitOfWork,
      proposedActions,
      appendSessionEvent,
      outbox,
      applyInstruction,
    ),
    apply,
    updateExecutionResult,
    appendEvent,
    outboxAppend,
  };
}

describe('ExecuteInstructionPatchUseCase', () => {
  it('caminho feliz: aplica a versão, narra instruction.patched e marca executed', async () => {
    const { useCase, apply, updateExecutionResult, appendEvent, outboxAppend } =
      buildHarness();

    await useCase.execute('proj-1', 'sess-1', buildAction());

    // A origem viaja até a versão gravada — é a ponta final da
    // rastreabilidade hipótese->patch->versão.
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'dev-api',
        sourceActionId: 'act-1',
        sourceHypothesisId: 'hyp-7',
        createdBy: 'user-9',
      }),
    );
    expect(updateExecutionResult).toHaveBeenCalledWith(
      'act-1',
      expect.objectContaining({ status: 'executed' }),
    );
    expect(appendEvent).toHaveBeenCalledWith(
      'proj-1',
      'sess-1',
      expect.objectContaining({ type: 'instruction.patched' }),
    );
    expect(outboxAppend).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'proposed_action.executed' }),
    );
  });

  it('patch sem hipótese de origem grava sourceHypothesisId null', async () => {
    const { useCase, apply } = buildHarness();

    await useCase.execute(
      'proj-1',
      'sess-1',
      buildAction({ hypothesisId: null }),
    );

    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ sourceHypothesisId: null }),
    );
  });

  it('falha ao aplicar NÃO lança: vira failed com o motivo narrado', async () => {
    // Mesma disciplina dos executores irmãos — a ação nunca fica presa em
    // `approved` esperando alguém.
    const { useCase, updateExecutionResult, appendEvent, outboxAppend } =
      buildHarness({ applyThrows: new Error('engine fora do ar') });

    await expect(
      useCase.execute('proj-1', 'sess-1', buildAction()),
    ).resolves.toBeDefined();

    expect(updateExecutionResult).toHaveBeenCalledWith(
      'act-1',
      expect.objectContaining({ status: 'failed' }),
    );
    expect(appendEvent).toHaveBeenCalledWith(
      'proj-1',
      'sess-1',
      expect.objectContaining({
        type: 'instruction.patch_failed',
        payload: expect.objectContaining({ reason: 'engine fora do ar' }),
      }),
    );
    expect(outboxAppend).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'proposed_action.failed' }),
    );
  });

  it('conteúdo idêntico ao vigente vira failed, não executed silencioso', async () => {
    const { useCase, updateExecutionResult, appendEvent } = buildHarness({
      changed: false,
    });

    await useCase.execute('proj-1', 'sess-1', buildAction());

    expect(updateExecutionResult).toHaveBeenCalledWith(
      'act-1',
      expect.objectContaining({ status: 'failed' }),
    );
    expect(appendEvent).toHaveBeenCalledWith(
      'proj-1',
      'sess-1',
      expect.objectContaining({ type: 'instruction.patch_failed' }),
    );
  });

  it('cache não invalidado não desfaz o patch — só aparece no resultado', async () => {
    // Invalidar é best-effort: o engine pode estar fora, e o patch continua
    // válido (o agente pega na rodada seguinte).
    const { useCase, updateExecutionResult } = buildHarness({
      cacheInvalidated: false,
    });

    await useCase.execute('proj-1', 'sess-1', buildAction());

    expect(updateExecutionResult).toHaveBeenCalledWith(
      'act-1',
      expect.objectContaining({
        status: 'executed',
        executionResult: expect.objectContaining({ cacheInvalidated: false }),
      }),
    );
  });
});
