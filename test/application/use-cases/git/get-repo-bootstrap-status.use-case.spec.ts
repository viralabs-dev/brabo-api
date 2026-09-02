import { describe, it, expect } from 'vitest';
import { GetRepoBootstrapStatusUseCase } from '../../../../src/application/use-cases/git/get-repo-bootstrap-status.use-case';
import {
  RepoBootstrapRepository,
  type NewRepoBootstrap,
  type RepoBootstrapPatch,
} from '../../../../src/application/ports/repo-bootstrap-repository.port';
import { ProposedActionRepository } from '../../../../src/application/ports/proposed-action-repository.port';
import type { ProposedAction } from '../../../../src/domain/actions/proposed-action.entity';
import type {
  BootstrapPlan,
  BootstrapPlanDecision,
  RepoBootstrap,
} from '../../../../src/domain/git/repo-bootstrap.entity';

class FakeRepoBootstrapRepository implements RepoBootstrapRepository {
  private row: RepoBootstrap | null = null;

  seed(row: RepoBootstrap) {
    this.row = row;
  }

  create(input: NewRepoBootstrap): Promise<RepoBootstrap> {
    this.row = {
      id: 'bootstrap-1',
      projectId: input.projectId,
      sessionId: input.sessionId,
      step: 'create_dev_branch',
      status: 'pending',
      attempts: 0,
      lastError: null,
      origin: input.origin ?? 'created',
      plan: null,
      planGeneratedAt: null,
      planDecision: null,
      planDecidedAt: null,
      planDecidedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return Promise.resolve(this.row);
  }

  findByProjectId(): Promise<RepoBootstrap | null> {
    return Promise.resolve(this.row);
  }

  update(
    _projectId: string,
    patch: RepoBootstrapPatch,
  ): Promise<RepoBootstrap> {
    this.row = { ...this.row!, ...patch, updatedAt: new Date() };
    return Promise.resolve(this.row);
  }

  savePlan(_projectId: string, plan: BootstrapPlan): Promise<RepoBootstrap> {
    this.row = { ...this.row!, plan, planGeneratedAt: new Date() };
    return Promise.resolve(this.row);
  }

  recordPlanDecision(
    _projectId: string,
    decision: BootstrapPlanDecision,
    decidedBy: string,
  ): Promise<RepoBootstrap> {
    this.row = {
      ...this.row!,
      planDecision: decision,
      planDecidedAt: new Date(),
      planDecidedBy: decidedBy,
    };
    return Promise.resolve(this.row);
  }
}

/**
 * O caso de uso passou a consultar as ações `git_repo_create` quando NÃO há
 * linha de bootstrap — é de lá que sai a falha que acontece antes de o cursor
 * existir (RN-477). Este dublê devolve só o que essa consulta pede.
 */
function fakeProposedActions(acoes: ProposedAction[] = []) {
  return {
    listByProjectAndType: () => Promise.resolve(acoes),
  } as unknown as ProposedActionRepository;
}

/** Uma ação de criação de repositório com o desfecho que o caso pede. */
function acaoDeCriacao(
  over: Partial<ProposedAction> & Pick<ProposedAction, 'status'>,
): ProposedAction {
  return {
    id: 'act-1',
    projectId: 'project-1',
    sessionId: 'session-1',
    seq: 1,
    actionType: 'git_repo_create',
    payload: {},
    resolvedPolicy: 'auto_approve',
    actor: { kind: 'system', id: 'git-bootstrap' },
    decidedBy: null,
    decidedAt: null,
    rejectionReason: null,
    executionResult: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

describe('GetRepoBootstrapStatusUseCase', () => {
  it('sem linha nenhuma: status null, attempts 0', async () => {
    const repo = new FakeRepoBootstrapRepository();
    const useCase = new GetRepoBootstrapStatusUseCase(repo, fakeProposedActions());

    const result = await useCase.execute('project-1');

    expect(result).toEqual({
      status: null,
      sessionId: null,
      failedStep: null,
      lastError: null,
      attempts: 0,
    });
  });

  it('passo falhou: expõe o passo culpado e o erro', async () => {
    const repo = new FakeRepoBootstrapRepository();
    repo.seed({
      id: 'bootstrap-1',
      projectId: 'project-1',
      sessionId: 'session-1',
      step: 'create_qa_branch',
      status: 'failed',
      attempts: 2,
      lastError: 'timeout ao criar branch',
      origin: 'created',
      plan: null,
      planGeneratedAt: null,
      planDecision: null,
      planDecidedAt: null,
      planDecidedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const useCase = new GetRepoBootstrapStatusUseCase(repo, fakeProposedActions());

    const result = await useCase.execute('project-1');

    expect(result).toEqual({
      status: 'provision_failed',
      sessionId: 'session-1',
      failedStep: 'create_qa_branch',
      lastError: 'timeout ao criar branch',
      attempts: 2,
    });
  });

  /**
   * Sem linha de bootstrap, mas com a criação do repositório fracassada — o
   * caso do uso real. `failedStep` fica NULO de propósito: o repositório não
   * chegou a existir, então nenhum dos seis passos foi tentado.
   */
  it('sem linha, mas com git_repo_create falhado: reporta o motivo, sem passo', async () => {
    const useCase = new GetRepoBootstrapStatusUseCase(
      new FakeRepoBootstrapRepository(),
      fakeProposedActions([
        acaoDeCriacao({
          status: 'failed',
          executionResult: {
            kind: 'git_bootstrap',
            detail: { error: 'permissão negada: /data/git-repos/exp001.git' },
          },
        }),
      ]),
    );

    const result = await useCase.execute('project-1');

    expect(result.status).toBe('provision_failed');
    expect(result.lastError).toBe('permissão negada: /data/git-repos/exp001.git');
    expect(result.failedStep).toBeNull();
    expect(result.sessionId).toBeNull();
  });

  it('a ação MAIS RECENTE é que manda: uma falha antiga já retomada não conta', async () => {
    const useCase = new GetRepoBootstrapStatusUseCase(
      new FakeRepoBootstrapRepository(),
      fakeProposedActions([
        acaoDeCriacao({
          id: 'act-antiga',
          seq: 1,
          status: 'failed',
          executionResult: {
            kind: 'git_bootstrap',
            detail: { error: 'permissão negada' },
          },
        }),
        acaoDeCriacao({ id: 'act-nova', seq: 2, status: 'executed' }),
      ]),
    );

    const result = await useCase.execute('project-1');

    expect(result.status).toBeNull();
    expect(result.lastError).toBeNull();
  });

  /**
   * Falhou sem detalhe legível: a tela precisa saber QUE falhou antes de
   * precisar saber por quê. Devolver `null` aqui a mandaria de volta para o
   * "Iniciando provisionamento…" eterno, que é o defeito original.
   */
  it('falhou sem detalhe registrado: ainda assim reporta a falha', async () => {
    const useCase = new GetRepoBootstrapStatusUseCase(
      new FakeRepoBootstrapRepository(),
      fakeProposedActions([acaoDeCriacao({ status: 'failed' })]),
    );

    const result = await useCase.execute('project-1');

    expect(result.status).toBe('provision_failed');
    expect(result.lastError).toContain('sem detalhe registrado');
  });
});
