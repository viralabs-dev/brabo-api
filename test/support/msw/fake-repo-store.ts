// Backend fake com estado em memória, compartilhado pelos handlers msw
// do GitHub e do GitLab — a suite de contrato (apps/api/test/contract/
// git-provider.contract.ts) encadeia createRepo→commitFiles(2x)→
// createBranch→listBranches→protectBranch/openPullRequest num único
// `provider` por teste, então um mock estático não basta: precisa
// refletir o que cada chamada anterior "criou", igual o LocalGitProvider
// faz de verdade via git. Shas gerados por contador monotônico
// (zero-padded pra 40 chars hex) — sempre distintos entre commits
// sequenciais, sempre no formato que a suite espera.

export interface FakeBranch {
  name: string;
  sha: string;
  protected: boolean;
}

export interface FakePullRequest {
  number: number;
  sourceBranch: string;
  targetBranch: string;
  title: string;
  state: 'open' | 'merged' | 'closed';
}

export interface FakeRepo {
  fullName: string;
  name: string;
  visibility: 'public' | 'private';
  defaultBranch: string;
  branches: Map<string, FakeBranch>;
  prs: FakePullRequest[];
}

export class FakeRepoStore {
  private shaCounter = 0;
  readonly repos = new Map<string, FakeRepo>();

  nextSha(): string {
    this.shaCounter += 1;
    return this.shaCounter.toString(16).padStart(40, '0');
  }

  createRepo(
    fullName: string,
    name: string,
    visibility: 'public' | 'private',
  ): FakeRepo {
    const repo: FakeRepo = {
      fullName,
      name,
      visibility,
      defaultBranch: 'main',
      branches: new Map(),
      prs: [],
    };
    this.repos.set(fullName, repo);
    return repo;
  }

  reset(): void {
    this.shaCounter = 0;
    this.repos.clear();
  }
}
