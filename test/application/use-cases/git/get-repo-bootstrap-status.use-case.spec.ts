import { describe, it, expect } from 'vitest';
import { GetRepoBootstrapStatusUseCase } from '../../../../src/application/use-cases/git/get-repo-bootstrap-status.use-case';
import {
  RepoBootstrapRepository,
  type NewRepoBootstrap,
  type RepoBootstrapPatch,
} from '../../../../src/application/ports/repo-bootstrap-repository.port';
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

describe('GetRepoBootstrapStatusUseCase', () => {
  it('sem linha nenhuma: status null, attempts 0', async () => {
    const repo = new FakeRepoBootstrapRepository();
    const useCase = new GetRepoBootstrapStatusUseCase(repo);

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
    const useCase = new GetRepoBootstrapStatusUseCase(repo);

    const result = await useCase.execute('project-1');

    expect(result).toEqual({
      status: 'provision_failed',
      sessionId: 'session-1',
      failedStep: 'create_qa_branch',
      lastError: 'timeout ao criar branch',
      attempts: 2,
    });
  });
});
