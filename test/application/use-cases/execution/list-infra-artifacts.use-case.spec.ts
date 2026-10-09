import { describe, it, expect, vi } from 'vitest';
import { ListInfraArtifactsUseCase } from '../../../../src/application/use-cases/execution/list-infra-artifacts.use-case';
import type { InfraArtifactRepository } from '../../../../src/application/ports/infra-artifact-repository.port';
import type { ProposedActionRepository } from '../../../../src/application/ports/proposed-action-repository.port';
import type { InfraArtifact } from '../../../../src/domain/execution/infra-artifact.entity';
import type { ProposedAction } from '../../../../src/domain/actions/proposed-action.entity';

const now = new Date();

function artefato(id: string, prActionId: string): InfraArtifact {
  return {
    id,
    projectId: 'proj-1',
    sessionId: 'sess-1',
    title: id,
    prActionId,
    gateStatus: 'awaiting_user',
    gateCorrectionCount: 0,
    blocked: false,
    blockedReason: null,
    createdAt: now,
    updatedAt: now,
  };
}

function acao(
  id: string,
  actionType: string,
  status: string,
  executionResult: unknown,
): ProposedAction {
  return {
    id,
    actionType,
    status,
    executionResult,
  } as unknown as ProposedAction;
}

function montar(acoes: ProposedAction[]) {
  const infraArtifacts = {
    listByProject: vi
      .fn()
      .mockResolvedValue([artefato('a1', 'open-1'), artefato('a2', 'open-2')]),
  } as unknown as InfraArtifactRepository;
  const proposedActions = {
    listByProjectAndType: vi.fn((_p: string, tipo: string) =>
      Promise.resolve(acoes.filter((a) => a.actionType === tipo)),
    ),
  } as unknown as ProposedActionRepository;
  return new ListInfraArtifactsUseCase(infraArtifacts, proposedActions);
}

const aberturas = [
  acao('open-1', 'open_infra_pr', 'executed', { pullRequestId: '7' }),
  acao('open-2', 'open_infra_pr', 'executed', { pullRequestId: '8' }),
];

describe('ListInfraArtifactsUseCase — RN-752', () => {
  it('tira da lista a PR de infra que um git_merge executado mergeou', async () => {
    const uc = montar([
      ...aberturas,
      acao('m1', 'git_merge', 'executed', {
        kind: 'git_merge',
        pullRequestId: '7',
        state: 'merged',
      }),
    ]);
    const lista = await uc.execute('proj-1');
    expect(lista.map((a) => a.id)).toEqual(['a2']);
  });

  it('mantém a PR quando o merge falhou ou ainda não executou', async () => {
    const uc = montar([
      ...aberturas,
      acao('m1', 'git_merge', 'failed', {
        pullRequestId: '7',
        state: 'merged',
      }),
      acao('m2', 'git_merge', 'pending', null),
    ]);
    const lista = await uc.execute('proj-1');
    expect(lista.map((a) => a.id)).toEqual(['a1', 'a2']);
  });
});
