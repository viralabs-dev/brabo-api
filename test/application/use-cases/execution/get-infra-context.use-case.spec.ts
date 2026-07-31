import { describe, it, expect } from 'vitest';
import { GetInfraContextUseCase } from '../../../../src/application/use-cases/execution/get-infra-context.use-case';
import type { ModuleMapRepository } from '../../../../src/application/ports/module-map-repository.port';
import type { ProposedActionRepository } from '../../../../src/application/ports/proposed-action-repository.port';
import type { ProvisionedRepositoryRepository } from '../../../../src/application/ports/provisioned-repository-repository.port';
import type { ModuleMap } from '../../../../src/domain/architecture/module-map.entity';
import type { ProposedAction } from '../../../../src/domain/actions/proposed-action.entity';
import type { ProvisionedRepository } from '../../../../src/domain/git/provisioned-repository.entity';

const now = new Date();

const moduleMap: ModuleMap = {
  id: 'mm-1',
  projectId: 'proj-1',
  sessionId: 'sess-1',
  modules: [{ name: 'api', stack: 'Node.js', responsibility: 'backend', dependsOn: [] }],
  version: 1,
  createdAt: now,
};

const adrAction: ProposedAction = {
  id: 'action-1',
  projectId: 'proj-1',
  sessionId: 'sess-1',
  seq: 1,
  actionType: 'open_adr_pr',
  payload: { title: 'Usar Postgres', content: '# ADR', infraRelevant: true },
  status: 'auto_approved',
  resolvedPolicy: 'auto_approve',
  actor: { kind: 'agent', id: 'arquiteto' },
  decidedBy: null,
  decidedAt: null,
  rejectionReason: null,
  executionResult: null,
} as unknown as ProposedAction;

const naoInfraAdrAction: ProposedAction = {
  ...adrAction,
  id: 'action-2',
  payload: { title: 'Decisão qualquer', content: '# ADR', infraRelevant: false },
} as unknown as ProposedAction;

function repo(provider: ProvisionedRepository['provider'] | null): ProvisionedRepositoryRepository {
  return {
    findByProjectId: async () =>
      provider === null
        ? null
        : ({
            id: 'repo-1',
            projectId: 'proj-1',
            provider,
            externalId: 'org/repo',
            url: 'https://example.com/org/repo',
            defaultBranch: 'main',
            visibility: 'private',
            provisionedBy: 'user-1',
            createdAt: now,
            updatedAt: now,
          } satisfies ProvisionedRepository),
    create: async () => {
      throw new Error('não usado neste teste');
    },
  };
}

function build(
  provider: ProvisionedRepository['provider'] | null,
  adrs: ProposedAction[] = [adrAction, naoInfraAdrAction],
) {
  return new GetInfraContextUseCase(
    { findCurrent: async () => moduleMap } as unknown as ModuleMapRepository,
    { listByProjectAndType: async () => adrs } as unknown as ProposedActionRepository,
    repo(provider),
  );
}

describe('GetInfraContextUseCase', () => {
  it('gitProvider vem do repositório provisionado do projeto', async () => {
    const useCase = build('github');
    const ctx = await useCase.execute('proj-1');
    expect(ctx.gitProvider).toBe('github');
  });

  it('gitProvider é null quando o projeto ainda não provisionou repositório', async () => {
    const useCase = build(null);
    const ctx = await useCase.execute('proj-1');
    expect(ctx.gitProvider).toBeNull();
  });

  it('gitlab também é repassado tal como está — sem normalização', async () => {
    const useCase = build('gitlab');
    const ctx = await useCase.execute('proj-1');
    expect(ctx.gitProvider).toBe('gitlab');
  });

  it('moduleMap e adrs infraRelevant continuam funcionando (regressão da Fase 4a)', async () => {
    const useCase = build('local');
    const ctx = await useCase.execute('proj-1');

    expect(ctx.moduleMap).toEqual(moduleMap);
    expect(ctx.adrs).toHaveLength(1);
    expect(ctx.adrs[0].title).toBe('Usar Postgres');
  });
});
