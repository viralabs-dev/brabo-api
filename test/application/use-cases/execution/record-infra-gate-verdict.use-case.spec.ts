import { describe, it, expect, vi } from 'vitest';
import { RecordInfraGateVerdictUseCase } from '../../../../src/application/use-cases/execution/record-infra-gate-verdict.use-case';
import type { MarkInfraArtifactBlockedUseCase } from '../../../../src/application/use-cases/execution/mark-infra-artifact-blocked.use-case';
import type { InfraArtifactRepository } from '../../../../src/application/ports/infra-artifact-repository.port';
import type { ProposedActionRepository } from '../../../../src/application/ports/proposed-action-repository.port';
import type { ProvisionedRepositoryRepository } from '../../../../src/application/ports/provisioned-repository-repository.port';
import type { GitProviderRegistry } from '../../../../src/application/ports/git-provider.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { InfraArtifact } from '../../../../src/domain/execution/infra-artifact.entity';
import type { ProposedAction } from '../../../../src/domain/actions/proposed-action.entity';
import type { ProvisionedRepository } from '../../../../src/domain/git/provisioned-repository.entity';

const now = new Date();

function buildArtifact(overrides: Partial<InfraArtifact> = {}): InfraArtifact {
  return {
    id: 'artifact-1',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    title: 'infra setup',
    prActionId: 'action-1',
    gateStatus: 'awaiting_qa',
    gateCorrectionCount: 0,
    blocked: false,
    blockedReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildPrAction(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: 'action-1',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    seq: 1,
    actionType: 'open_infra_pr',
    payload: { title: 'infra setup', files: [] },
    status: 'executed',
    resolvedPolicy: 'auto_approve',
    actor: { kind: 'agent', id: 'infra' },
    decidedBy: null,
    decidedAt: null,
    rejectionReason: null,
    executionResult: {
      pullRequestUrl: 'local://repo/pull/1',
      pullRequestId: 'pr-1',
      branch: 'feature/infra-setup',
      paths: ['Dockerfile'],
      title: 'infra setup',
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildHarness(opts: {
  artifact?: InfraArtifact | null;
  prAction?: ProposedAction | null;
  repo?: ProvisionedRepository | null;
}) {
  const artifact = opts.artifact === undefined ? buildArtifact() : opts.artifact;
  const prAction = opts.prAction === undefined ? buildPrAction() : opts.prAction;
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
    (id: string, gateStatus: InfraArtifact['gateStatus'], correctionCount: number) =>
      Promise.resolve({
        ...(artifact as InfraArtifact),
        gateStatus,
        gateCorrectionCount: correctionCount,
      }),
  );

  const infraArtifacts = {
    findByPrActionId: () => Promise.resolve(artifact),
    updateGateStatus,
  } as unknown as InfraArtifactRepository;

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

  const markInfraArtifactBlockedExecute = vi.fn(() =>
    Promise.resolve({ ...(artifact as InfraArtifact), blocked: true }),
  );
  const markInfraArtifactBlocked = {
    execute: markInfraArtifactBlockedExecute,
  } as unknown as MarkInfraArtifactBlockedUseCase;

  const useCase = new RecordInfraGateVerdictUseCase(
    infraArtifacts,
    proposedActions,
    repositories,
    gitProviders,
    appendEvent,
    markInfraArtifactBlocked,
  );

  return {
    useCase,
    updateGateStatus,
    commentOnPullRequest,
    markInfraArtifactBlockedExecute,
    appendEvent,
  };
}

describe('RecordInfraGateVerdictUseCase', () => {
  it('QA aprovado: avança pro secops, comenta a PR', async () => {
    const { useCase, updateGateStatus, commentOnPullRequest } = buildHarness({});

    const result = await useCase.execute('proj-1', 'sess-1', {
      prActionId: 'action-1',
      gate: 'qa',
      veredito: 'approved',
      resumo: 'nenhum achado de lint',
      itens: [],
    });

    expect(result.nextAction).toBe('run_secops');
    expect(updateGateStatus).toHaveBeenCalledWith('artifact-1', 'awaiting_secops', 0);
    expect(commentOnPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ pullRequestId: 'pr-1' }),
    );
  });

  it('SecOps aprovado: chega em awaiting_user, nextAction done', async () => {
    const { useCase } = buildHarness({
      artifact: buildArtifact({ gateStatus: 'awaiting_secops' }),
    });

    const result = await useCase.execute('proj-1', 'sess-1', {
      prActionId: 'action-1',
      gate: 'secops',
      veredito: 'approved',
      resumo: 'nenhum achado',
      itens: [],
    });

    expect(result.nextAction).toBe('done');
    expect(result.artifact.gateStatus).toBe('awaiting_user');
  });

  it('changes_requested sob o teto: nextAction correct, gate mantido', async () => {
    const { useCase, updateGateStatus } = buildHarness({});

    const result = await useCase.execute(
      'proj-1',
      'sess-1',
      {
        prActionId: 'action-1',
        gate: 'qa',
        veredito: 'changes_requested',
        resumo: 'Dockerfile com erro de lint',
        itens: ['DL3006: pin a versão da imagem base'],
      },
      3,
    );

    expect(result.nextAction).toBe('correct');
    expect(updateGateStatus).toHaveBeenCalledWith('artifact-1', 'awaiting_qa', 1);
  });

  it('changes_requested estourando o teto: bloqueia via MarkInfraArtifactBlockedUseCase', async () => {
    const { useCase, markInfraArtifactBlockedExecute, updateGateStatus } = buildHarness({
      artifact: buildArtifact({ gateCorrectionCount: 3 }),
    });

    const result = await useCase.execute(
      'proj-1',
      'sess-1',
      {
        prActionId: 'action-1',
        gate: 'qa',
        veredito: 'changes_requested',
        resumo: 'ainda falhando',
        itens: ['x'],
      },
      3,
    );

    expect(result.nextAction).toBe('blocked');
    expect(markInfraArtifactBlockedExecute).toHaveBeenCalledWith(
      'proj-1',
      'sess-1',
      'artifact-1',
      'ciclo de correção esgotado (gate)',
      'ainda falhando',
      'qa-agent',
    );
    expect(updateGateStatus).not.toHaveBeenCalled();
  });

  it('falha ao comentar na PR não impede a decisão do gate (best-effort)', async () => {
    const { useCase } = buildHarness({ repo: null });

    const result = await useCase.execute('proj-1', 'sess-1', {
      prActionId: 'action-1',
      gate: 'qa',
      veredito: 'approved',
      resumo: 'ok',
      itens: [],
    });

    expect(result.nextAction).toBe('run_secops');
  });

  it('artefato já bloqueado rejeita novo parecer', async () => {
    const { useCase } = buildHarness({
      artifact: buildArtifact({ blocked: true }),
    });

    await expect(
      useCase.execute('proj-1', 'sess-1', {
        prActionId: 'action-1',
        gate: 'qa',
        veredito: 'approved',
        resumo: 'ok',
        itens: [],
      }),
    ).rejects.toThrow();
  });
});
