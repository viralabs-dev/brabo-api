import { describe, it, expect, vi } from 'vitest';
import { ProposeInstructionPatchUseCase } from '../../../../src/application/use-cases/instructions/propose-instruction-patch.use-case';
import type { AgentInstructionRepository } from '../../../../src/application/ports/agent-instruction-repository.port';
import type { ProposedActionRepository } from '../../../../src/application/ports/proposed-action-repository.port';
import type { ProposeActionUseCase } from '../../../../src/application/use-cases/actions/propose-action.use-case';
import type { ProposedAction } from '../../../../src/domain/actions/proposed-action.entity';

const now = new Date();
const CURRENT = 'Você é o dev-api.\nExplique cada conceito básico.\n';

function deniedAction(
  agent: string,
  proposedContent: string,
): ProposedAction {
  return {
    id: 'act-denied',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    seq: 1,
    actionType: 'instruction_patch',
    payload: { agent, proposedContent },
    status: 'denied',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'agent', id: 'anamnese' },
    decidedBy: 'user-1',
    decidedAt: now,
    rejectionReason: 'não concordo',
    executionResult: null,
    createdAt: now,
    updatedAt: now,
  };
}

function buildHarness(opts: { priorActions?: ProposedAction[] } = {}) {
  const instructions = {
    findByProjectAndAgent: () =>
      Promise.resolve({
        id: 'ai-1',
        projectId: 'proj-1',
        agent: 'dev-api',
        content: CURRENT,
        version: 2,
        createdAt: now,
        updatedAt: now,
      }),
  } as unknown as AgentInstructionRepository;

  const proposedActions = {
    listByProjectAndType: () => Promise.resolve(opts.priorActions ?? []),
  } as unknown as ProposedActionRepository;

  const proposeExecute = vi.fn((_p: string, _s: string, input: unknown) =>
    Promise.resolve({ id: 'act-new', ...(input as object) } as never),
  );
  const proposeAction = {
    execute: proposeExecute,
  } as unknown as ProposeActionUseCase;

  return {
    useCase: new ProposeInstructionPatchUseCase(
      instructions,
      proposedActions,
      proposeAction,
    ),
    proposeExecute,
  };
}

describe('ProposeInstructionPatchUseCase', () => {
  it('caminho feliz: propõe com o diff já no formato do renderer', async () => {
    const { useCase, proposeExecute } = buildHarness();

    await useCase.execute('proj-1', 'sess-1', {
      agent: 'dev-api',
      proposedContent: 'Você é o dev-api.\nAssuma familiaridade com NestJS.\n',
      rationale: 'usuário é sênior em NestJS',
    });

    expect(proposeExecute).toHaveBeenCalledTimes(1);
    const input = proposeExecute.mock.calls[0][2] as {
      actionType: string;
      payload: {
        agent: string;
        fromVersion: number;
        files: { additions: number; deletions: number; lines: unknown[] }[];
      };
    };
    expect(input.actionType).toBe('instruction_patch');
    expect(input.payload.agent).toBe('dev-api');
    expect(input.payload.fromVersion).toBe(2);
    expect(input.payload.files).toHaveLength(1);
    expect(input.payload.files[0].additions).toBe(1);
    expect(input.payload.files[0].deletions).toBe(1);
    expect(input.payload.files[0].lines.length).toBeGreaterThan(0);
  });

  it('propaga hypothesisId (loop fechado: patch referencia a hipótese de origem)', async () => {
    const { useCase, proposeExecute } = buildHarness();

    await useCase.execute('proj-1', 'sess-1', {
      agent: 'dev-api',
      proposedContent: 'Você é o dev-api.\nSeja direto.\n',
      rationale: 'derivado de hipótese aceita',
      hypothesisId: 'hyp-7',
    });

    const input = proposeExecute.mock.calls[0][2] as {
      payload: { hypothesisId: string | null };
    };
    expect(input.payload.hypothesisId).toBe('hyp-7');
  });

  it('patch idêntico a um JÁ NEGADO é rejeitado (não repropõe igual)', async () => {
    const rejectedContent = 'Você é o dev-api.\nSeja direto.\n';
    const { useCase, proposeExecute } = buildHarness({
      priorActions: [deniedAction('dev-api', rejectedContent)],
    });

    await expect(
      useCase.execute('proj-1', 'sess-1', {
        agent: 'dev-api',
        proposedContent: rejectedContent,
        rationale: 'tentando de novo',
      }),
    ).rejects.toThrow(/já foi negado/);
    expect(proposeExecute).not.toHaveBeenCalled();
  });

  it('negado com diferença só de whitespace ainda conta como igual', async () => {
    const { useCase } = buildHarness({
      priorActions: [
        deniedAction('dev-api', 'Você é o dev-api.\nSeja direto.\n'),
      ],
    });

    await expect(
      useCase.execute('proj-1', 'sess-1', {
        agent: 'dev-api',
        proposedContent: 'Você é o dev-api.   \r\nSeja direto.  \n\n',
        rationale: 'disfarçado',
      }),
    ).rejects.toThrow(/já foi negado/);
  });

  it('negado para OUTRO agente não bloqueia este', async () => {
    const content = 'Você é o dev-api.\nSeja direto.\n';
    const { useCase, proposeExecute } = buildHarness({
      priorActions: [deniedAction('dev-web', content)],
    });

    await useCase.execute('proj-1', 'sess-1', {
      agent: 'dev-api',
      proposedContent: content,
      rationale: 'ok',
    });

    expect(proposeExecute).toHaveBeenCalled();
  });

  it('conteúdo idêntico ao vigente é rejeitado (nada a patchear)', async () => {
    const { useCase } = buildHarness();

    await expect(
      useCase.execute('proj-1', 'sess-1', {
        agent: 'dev-api',
        proposedContent: CURRENT,
        rationale: 'sem mudança',
      }),
    ).rejects.toThrow(/idêntico ao vigente/);
  });

  it('conteúdo vazio é rejeitado', async () => {
    const { useCase } = buildHarness();

    await expect(
      useCase.execute('proj-1', 'sess-1', {
        agent: 'dev-api',
        proposedContent: '   ',
        rationale: 'vazio',
      }),
    ).rejects.toThrow(/vazio/);
  });
});
