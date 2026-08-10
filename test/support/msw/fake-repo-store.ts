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
  // Conteúdo de arquivo por caminho NA PONTA desta branch — só usado
  // pelo backend fake do GitLab (commitFiles manda o estado completo
  // dos arquivos por commit, sem grafo de blob/tree/commit separado
  // como o GitHub — ver github-fake-backend.ts pra esse caso).
  files?: Map<string, string>;
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

  // Grafo de objetos git do backend fake do GitHub — commitFiles de
  // verdade passa por blob→tree→commit→ref; guardamos o suficiente
  // desse grafo (conteúdo por blob sha, path→conteúdo por tree sha,
  // tree sha por commit sha) pra `getFileContent` conseguir resolver
  // ref→commit→tree→path sem reimplementar um repositório git de
  // verdade. Só o backend do GitHub usa isso.
  readonly blobContent = new Map<string, string>();
  readonly treeFiles = new Map<string, Map<string, string>>();
  readonly commitTree = new Map<string, string>();

  /**
   * Lineage de commit (sha -> shas dos pais) — só o suficiente pra computar
   * ahead/behind (FASE 26b, `listBranchesDetailed`) sem reimplementar um
   * repositório git de verdade. Populado pelos DOIS backends fake — GitHub
   * em `git/commits`/Contents API, GitLab em `repository/commits` — e
   * consumido por `ancestraisDe`/`aheadBehind` abaixo.
   */
  readonly commitParents = new Map<string, string[]>();

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
    this.blobContent.clear();
    this.treeFiles.clear();
    this.commitTree.clear();
    this.commitParents.clear();
  }
}

/** Todo sha alcançável a partir de `sha`, subindo por `commitParents`. */
function ancestraisDe(store: FakeRepoStore, sha: string): Set<string> {
  const vistos = new Set<string>();
  const fila = [sha];
  while (fila.length > 0) {
    const atual = fila.shift()!;
    if (vistos.has(atual)) continue;
    vistos.add(atual);
    fila.push(...(store.commitParents.get(atual) ?? []));
  }
  return vistos;
}

/**
 * `ahead`/`behind` de `head` contra `base`, no mesmo vocabulário do
 * `ahead_by`/`behind_by` do GitHub — commits alcançáveis de um lado e não do
 * outro. Usado pelos handlers de compare dos DOIS backends fake.
 */
export function aheadBehind(
  store: FakeRepoStore,
  baseSha: string,
  headSha: string,
): { ahead: number; behind: number } {
  const daBase = ancestraisDe(store, baseSha);
  const doHead = ancestraisDe(store, headSha);
  let ahead = 0;
  for (const sha of doHead) if (!daBase.has(sha)) ahead += 1;
  let behind = 0;
  for (const sha of daBase) if (!doHead.has(sha)) behind += 1;
  return { ahead, behind };
}
