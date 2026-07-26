import { describe, it, expect, vi } from 'vitest';
import { GetAnamneseContextUseCase } from '../../../../src/application/use-cases/anamnese/get-anamnese-context.use-case';
import type { ProjectRepository } from '../../../../src/application/ports/project-repository.port';
import type { ModuleMapRepository } from '../../../../src/application/ports/module-map-repository.port';
import type { AgentInstructionRepository } from '../../../../src/application/ports/agent-instruction-repository.port';
import type { PsychologistHypothesisRepository } from '../../../../src/application/ports/psychologist-hypothesis-repository.port';
import type {
  AnamneseOptOutRepository,
  ProficiencyProfileRepository,
} from '../../../../src/application/ports/proficiency-profile-repository.port';
import type {
  AnamneseQueueRepository,
  AnamneseRunRepository,
} from '../../../../src/application/ports/anamnese-repository.port';
import type { ProposedActionRepository } from '../../../../src/application/ports/proposed-action-repository.port';
import type { ProposedAction } from '../../../../src/domain/actions/proposed-action.entity';

const now = new Date();

function decidedAction(
  overrides: Partial<ProposedAction> = {},
): ProposedAction {
  return {
    id: 'act-1',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    seq: 1,
    actionType: 'terminal',
    payload: { command: 'pnpm test' },
    status: 'executed',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'agent', id: 'dev-api' },
    decidedBy: 'user-1',
    decidedAt: now,
    rejectionReason: null,
    executionResult: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as ProposedAction;
}

function buildHarness(
  opts: {
    decisions?: ProposedAction[];
    optedOut?: string[];
    lastRunWindowTo?: Date | null;
    stacks?: string[];
  } = {},
) {
  const projects = {
    listMembers: () =>
      Promise.resolve([
        { userId: 'user-1', name: 'Dani', email: 'd@x.dev', role: 'owner' },
        { userId: 'user-2', name: 'Outro', email: 'o@x.dev', role: 'viewer' },
      ]),
  } as unknown as ProjectRepository;

  const moduleMaps = {
    findCurrent: () =>
      Promise.resolve({
        modules: (opts.stacks ?? ['NestJS + Drizzle']).map((stack) => ({
          stack,
        })),
      }),
  } as unknown as ModuleMapRepository;

  const instructions = {
    findByProjectAndAgent: () => Promise.resolve(null),
  } as unknown as AgentInstructionRepository;

  const hypotheses = {
    findById: () => Promise.resolve(null),
  } as unknown as PsychologistHypothesisRepository;

  const profiles = {
    listByProject: () => Promise.resolve([]),
  } as unknown as ProficiencyProfileRepository;

  const optOuts = {
    listOptedOutUserIds: () => Promise.resolve(opts.optedOut ?? []),
  } as unknown as AnamneseOptOutRepository;

  const queue = {
    listPending: () => Promise.resolve([]),
  } as unknown as AnamneseQueueRepository;

  const runs = {
    findLatest: () =>
      Promise.resolve(
        opts.lastRunWindowTo ? { windowTo: opts.lastRunWindowTo } : null,
      ),
  } as unknown as AnamneseRunRepository;

  const listDecidedInWindow = vi.fn(() =>
    Promise.resolve(opts.decisions ?? []),
  );
  const proposedActions = {
    listDecidedInWindow,
  } as unknown as ProposedActionRepository;

  return {
    useCase: new GetAnamneseContextUseCase(
      projects,
      moduleMaps,
      instructions,
      hypotheses,
      profiles,
      optOuts,
      queue,
      runs,
      proposedActions,
    ),
    listDecidedInWindow,
  };
}

describe('GetAnamneseContextUseCase', () => {
  it('catálogo já vem tokenizado (o modelo recebe a tecnologia isolada)', async () => {
    const { useCase } = buildHarness({ stacks: ['NestJS + Drizzle'] });

    const ctx = await useCase.execute('proj-1');

    expect(ctx.competencyCatalog).toContain('nestjs');
    expect(ctx.competencyCatalog).toContain('drizzle');
    expect(ctx.competencyCatalog).toContain('git');
  });

  it('aprovação que JÁ EXECUTOU conta como decisão do usuário', async () => {
    // O status dela é `executed`, não `approved` — filtrar por status
    // esconderia justamente as aprovações que viraram algo.
    const { useCase } = buildHarness({
      decisions: [decidedAction({ status: 'executed' })],
    });

    const ctx = await useCase.execute('proj-1');

    expect(ctx.decisions).toHaveLength(1);
    expect(ctx.decisions[0].status).toBe('executed');
  });

  it('o motivo da negação viaja no contexto', async () => {
    const { useCase } = buildHarness({
      decisions: [
        decidedAction({
          status: 'denied',
          rejectionReason: 'nunca use push --force',
        }),
      ],
    });

    const ctx = await useCase.execute('proj-1');

    expect(ctx.decisions[0].rejectionReason).toBe('nunca use push --force');
  });

  it('decisão de quem optou por sair não entra', async () => {
    const { useCase } = buildHarness({
      decisions: [decidedAction({ decidedBy: 'user-1' })],
      optedOut: ['user-1'],
    });

    const ctx = await useCase.execute('proj-1');

    expect(ctx.decisions).toHaveLength(0);
    expect(ctx.members.map((m) => m.userId)).not.toContain('user-1');
  });

  it('a janela das decisões começa no fim da última rodada', async () => {
    const windowTo = new Date(now.getTime() - 3600_000);
    const { useCase, listDecidedInWindow } = buildHarness({
      lastRunWindowTo: windowTo,
    });

    const ctx = await useCase.execute('proj-1');

    expect(listDecidedInWindow).toHaveBeenCalledWith(
      'proj-1',
      windowTo,
      expect.any(Date),
    );
    expect(ctx.windowFrom).toBe(windowTo.toISOString());
  });

  it('primeira rodada não tem windowFrom mas ainda lê decisões', async () => {
    const { useCase, listDecidedInWindow } = buildHarness();

    const ctx = await useCase.execute('proj-1');

    expect(ctx.windowFrom).toBeNull();
    expect(listDecidedInWindow).toHaveBeenCalled();
  });
});
