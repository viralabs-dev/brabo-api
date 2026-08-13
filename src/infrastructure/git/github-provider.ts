import { Injectable } from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import type {
  BlameInput,
  CommitFilesInput,
  CreateBranchInput,
  CreateRepoInput,
  GetFileContentInput,
  GetPullRequestDiffInput,
  GetRepoInput,
  GitBlame,
  GitBlameLine,
  GitBranch,
  GitBranchDetail,
  GitBranchDetailList,
  GitCommitResult,
  GitDiffFileStatus,
  GitProviderCapabilities,
  GitProviderContract,
  GitProviderName,
  GitPullRequest,
  GitPullRequestDiff,
  GitPullRequestList,
  GitPullRequestSummary,
  GitRepo,
  GitTree,
  ListBranchesDetailedInput,
  ListBranchesInput,
  ListPullRequestsInput,
  ListTreeInput,
  MergePullRequestInput,
  OpenPullRequestInput,
  ProtectBranchInput,
  CommentOnPullRequestInput,
} from '@brabo/shared';
import {
  GIT_BLAME_LINE_LIMIT,
  GIT_BRANCH_DETAIL_LIMIT,
  GIT_DIFF_FILE_LIMIT,
  GIT_PR_LIST_LIMIT,
  GIT_TREE_ENTRY_LIMIT,
} from '../../domain/git/git-read-limits';
import {
  GitBranchAlreadyExistsError,
  GitBranchNotFoundError,
  GitPermissionDeniedError,
  GitRepoAlreadyExistsError,
  GitRepoNotFoundError,
} from '../../domain/git/git-errors';
import { withRetry } from './retry';

/**
 * Implementa `GitProviderContract` (ver docs/adr/0001) — as 15 operações
 * normalizadas, das 9 da Fase 2 às três de fundação da FASE 26b (`blame`,
 * `listPullRequests`, `listBranchesDetailed`).
 */
@Injectable()
export class GithubProvider implements GitProviderContract {
  readonly name: GitProviderName = 'github';

  readonly capabilities: GitProviderCapabilities = {
    protectBranch: true,
    pullRequests: true,
    listTree: true,
    pullRequestDiff: true,
    // As três provadas pela suite de contrato (mockada, ver
    // test/infrastructure/git/github-provider.contract.spec.ts): `blame` via
    // GraphQL (a REST não tem essa operação), `listPullRequests` via
    // `pulls.list`, e `listBranchesDetailed` via `compareCommitsWithBasehead`,
    // que devolve os dois lados (`ahead_by`/`behind_by`) numa chamada só.
    blame: true,
    pullRequestsList: true,
    branchesDetailed: true,
  };

  async createRepo(input: CreateRepoInput): Promise<GitRepo> {
    const octokit = new Octokit({ auth: input.accessToken });

    try {
      const { data } = input.namespace
        ? await octokit.rest.repos.createInOrg({
            org: input.namespace,
            name: input.name,
            private: input.visibility === 'private',
            auto_init: false,
          })
        : await octokit.rest.repos.createForAuthenticatedUser({
            name: input.name,
            private: input.visibility === 'private',
            auto_init: false,
          });

      return {
        externalId: data.full_name,
        name: input.name,
        url: data.clone_url ?? data.html_url,
        defaultBranch: data.default_branch ?? 'main',
        visibility: input.visibility,
      };
    } catch (error) {
      if (
        getStatus(error) === 422 &&
        /already exists/i.test(getBodyText(error))
      ) {
        throw new GitRepoAlreadyExistsError(input.name);
      }
      if (getStatus(error) === 403 && !isRateLimited(error)) {
        throw new GitPermissionDeniedError(input.name);
      }
      throw error;
    }
  }

  async getRepo(input: GetRepoInput): Promise<GitRepo> {
    const [owner, repo] = splitFullName(input.externalId);
    const octokit = new Octokit({ auth: input.accessToken });

    try {
      const { data } = await withRetry(
        () => octokit.rest.repos.get({ owner, repo }),
        { shouldRetry: isRetryableReadError },
      );
      return {
        externalId: data.full_name,
        name: data.name,
        url: data.clone_url ?? data.html_url,
        defaultBranch: data.default_branch ?? 'main',
        visibility: data.private ? 'private' : 'public',
      };
    } catch (error) {
      if (getStatus(error) === 404)
        throw new GitRepoNotFoundError(input.externalId);
      if (getStatus(error) === 403 && !isRateLimited(error)) {
        throw new GitPermissionDeniedError(input.externalId);
      }
      throw error;
    }
  }

  async createBranch(input: CreateBranchInput): Promise<GitBranch> {
    const [owner, repo] = splitFullName(input.externalId);
    const octokit = new Octokit({ auth: input.accessToken });

    let sha: string;
    try {
      const { data } = await octokit.rest.git.getRef({
        owner,
        repo,
        ref: `heads/${input.fromRef}`,
      });
      sha = data.object.sha;
    } catch (error) {
      const status = getStatus(error);
      // 404 é a branch que não existe; 409 é o repo inteiro sem commit nenhum
      // (`Git Repository is empty`). Para QUEM PEDIU, os dois dizem a mesma
      // coisa: a ref de origem não está lá. Deixar o 409 vazar como erro cru
      // faria "criar branch antes do primeiro commit" morrer sem diagnóstico.
      if (status === 404 || status === 409) {
        throw new GitBranchNotFoundError(input.externalId, input.fromRef);
      }
      throw error;
    }

    try {
      await octokit.rest.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${input.branchName}`,
        sha,
      });
    } catch (error) {
      if (
        getStatus(error) === 422 &&
        /already exists/i.test(getBodyText(error))
      ) {
        throw new GitBranchAlreadyExistsError(
          input.externalId,
          input.branchName,
        );
      }
      throw error;
    }

    return { name: input.branchName, commitSha: sha, protected: false };
  }

  async protectBranch(input: ProtectBranchInput): Promise<void> {
    const [owner, repo] = splitFullName(input.externalId);
    const octokit = new Octokit({ auth: input.accessToken });

    try {
      // GitHub modela proteção de branch como um conjunto rico de regras
      // independentes num payload só (status checks obrigatórios,
      // contagem mínima de revisores, restrições de quem pode dar push,
      // enforce_admins) — bem mais granular que o GitLab, que só tem dois
      // níveis de acesso (push/merge, ver gitlab-provider.ts). Como
      // `ProtectBranchInput` não carrega configuração nenhuma ainda,
      // aplicamos o mais restritivo razoável dado o que já existe: bloqueia
      // até admin burlar a proteção e exige 1 aprovação, sem status-checks
      // (nenhum CI modelado ainda) nem restrição adicional de push.
      //
      // ATENÇÃO ao efeito de `required_approving_review_count: 1` junto com
      // `enforce_admins: true`: é uma exigência de aprovação DA PLATAFORMA que
      // a matriz do domínio (QA -> SecOps -> usuário) não preenche, e sem o
      // bypass de admin ela pode BLOQUEAR o merge manual do usuário num
      // repositório de dono único. Decisão e contorno em docs/adr/0028.
      await octokit.rest.repos.updateBranchProtection({
        owner,
        repo,
        branch: input.branchName,
        enforce_admins: true,
        required_pull_request_reviews: { required_approving_review_count: 1 },
        required_status_checks: null,
        restrictions: null,
      });
    } catch (error) {
      if (getStatus(error) === 404) {
        throw new GitBranchNotFoundError(input.externalId, input.branchName);
      }
      throw error;
    }
  }

  async commitFiles(input: CommitFilesInput): Promise<GitCommitResult> {
    if (input.files.length === 0) {
      throw new Error('commitFiles requer ao menos um arquivo em `files`');
    }

    const [owner, repo] = splitFullName(input.externalId);
    const octokit = new Octokit({ auth: input.accessToken });

    let parentSha: string | undefined;
    /**
     * Repo SEM commit nenhum. Num repositório vazio o GitHub recusa a Git Data
     * API INTEIRA com `409 Git Repository is empty` — refs, blobs, trees,
     * commits —, então não há como montar o primeiro commit por ali. Quem
     * funciona é a Contents API, que cria arquivo, commit e branch de uma vez.
     * Verificado contra a API viva (2026-08-04): `git/ref` 409, `git/blobs`
     * 409, `PUT /contents/<path>` cria.
     */
    let repoVazio = false;
    try {
      const { data } = await octokit.rest.git.getRef({
        owner,
        repo,
        ref: `heads/${input.branch}`,
      });
      parentSha = data.object.sha;
    } catch (error) {
      const status = getStatus(error);

      // 409 `Git Repository is empty`: o repo não tem commit NENHUM, e a API
      // de refs inteira responde isso — inclusive o `listMatchingRefs` logo
      // abaixo. O 409 já É a prova de que este é o primeiro commit, então
      // perguntar de novo só devolveria outro 409 e mataria o bootstrap no
      // primeiro passo. Era exatamente o que acontecia: o caminho de repo
      // vazio existia, guardado por um status que o GitHub não usa.
      if (status === 409) {
        repoVazio = true;
      } else {
        if (status !== 404) throw error;
        // 404 é a branch que não existe num repo que TEM refs — aí a
        // distinção importa: primeiro commit, ou branch inventada?
        const { data: refs } = await octokit.rest.git.listMatchingRefs({
          owner,
          repo,
          ref: 'heads/',
        });
        if (refs.length > 0) {
          throw new GitBranchNotFoundError(input.externalId, input.branch);
        }
      }
    }

    if (repoVazio) {
      return this.primeiroCommitEmRepoVazio(octokit, owner, repo, input);
    }

    let baseTreeSha: string | undefined;
    if (parentSha) {
      const { data: parentCommit } = await octokit.rest.git.getCommit({
        owner,
        repo,
        commit_sha: parentSha,
      });
      baseTreeSha = parentCommit.tree.sha;
    }

    const blobs = await Promise.all(
      input.files.map(async (file) => {
        const { data } = await octokit.rest.git.createBlob({
          owner,
          repo,
          content: Buffer.from(file.content, 'utf8').toString('base64'),
          encoding: 'base64',
        });
        return { path: file.path, sha: data.sha };
      }),
    );

    const { data: tree } = await octokit.rest.git.createTree({
      owner,
      repo,
      base_tree: baseTreeSha,
      tree: blobs.map((blob) => ({
        path: blob.path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha,
      })),
    });

    const { data: commit } = await octokit.rest.git.createCommit({
      owner,
      repo,
      message: input.message,
      tree: tree.sha,
      parents: parentSha ? [parentSha] : [],
    });

    if (parentSha) {
      await octokit.rest.git.updateRef({
        owner,
        repo,
        ref: `heads/${input.branch}`,
        sha: commit.sha,
      });
    } else {
      await octokit.rest.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${input.branch}`,
        sha: commit.sha,
      });
    }

    return { sha: commit.sha, branch: input.branch };
  }

  /**
   * O primeiro commit de um repositório vazio, pela Contents API.
   *
   * Com UM arquivo — o caso do bootstrap, que commita um por passo — sai
   * exatamente um commit, como o contrato promete. Com mais de um, o primeiro
   * nasce aqui (é ele que cria a branch) e o resto vai num segundo commit pelo
   * caminho normal: dois commits em vez de um, degradação declarada, porque a
   * alternativa seria recusar o commit inicial multiarquivo — que é pior.
   */
  private async primeiroCommitEmRepoVazio(
    octokit: Octokit,
    owner: string,
    repo: string,
    input: CommitFilesInput,
  ): Promise<GitCommitResult> {
    const [primeiro, ...resto] = input.files;

    const { data } = await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: primeiro.path,
      message: input.message,
      content: Buffer.from(primeiro.content, 'utf8').toString('base64'),
      branch: input.branch,
    });

    const sha = data.commit.sha ?? '';
    if (resto.length === 0) return { sha, branch: input.branch };

    // A branch existe agora, então o caminho normal volta a valer.
    return this.commitFiles({ ...input, files: resto });
  }

  async listBranches(input: ListBranchesInput): Promise<GitBranch[]> {
    const [owner, repo] = splitFullName(input.externalId);
    const octokit = new Octokit({ auth: input.accessToken });

    try {
      const { data } = await withRetry(
        () => octokit.rest.repos.listBranches({ owner, repo, per_page: 100 }),
        { shouldRetry: isRetryableReadError },
      );
      return data.map((branch) => ({
        name: branch.name,
        commitSha: branch.commit.sha,
        protected: branch.protected ?? false,
      }));
    } catch (error) {
      if (getStatus(error) === 404)
        throw new GitRepoNotFoundError(input.externalId);
      throw error;
    }
  }

  async getFileContent(input: GetFileContentInput): Promise<string | null> {
    const [owner, repo] = splitFullName(input.externalId);
    const octokit = new Octokit({ auth: input.accessToken });

    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: input.path,
        ref: input.branch,
      });
      if (Array.isArray(data) || data.type !== 'file') {
        throw new Error(
          `getFileContent: "${input.path}" não resolve pra um arquivo único`,
        );
      }
      return Buffer.from(data.content, 'base64').toString('utf8');
    } catch (error) {
      if (getStatus(error) === 404) return null;
      throw error;
    }
  }

  async openPullRequest(input: OpenPullRequestInput): Promise<GitPullRequest> {
    const [owner, repo] = splitFullName(input.externalId);
    const octokit = new Octokit({ auth: input.accessToken });

    const { data } = await octokit.rest.pulls.create({
      owner,
      repo,
      title: input.title,
      head: input.sourceBranch,
      base: input.targetBranch,
      body: input.body,
    });

    return {
      id: String(data.id),
      number: data.number,
      url: data.html_url,
      sourceBranch: input.sourceBranch,
      targetBranch: input.targetBranch,
      state: 'open',
    };
  }

  async mergePullRequest(
    input: MergePullRequestInput,
  ): Promise<GitPullRequest> {
    const [owner, repo] = splitFullName(input.externalId);
    const octokit = new Octokit({ auth: input.accessToken });
    const pullNumber = Number(input.pullRequestId);

    await octokit.rest.pulls.merge({ owner, repo, pull_number: pullNumber });
    const { data } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });

    return {
      id: String(data.id),
      number: data.number,
      url: data.html_url,
      sourceBranch: data.head.ref,
      targetBranch: data.base.ref,
      state: 'merged',
    };
  }

  async commentOnPullRequest(input: CommentOnPullRequestInput): Promise<void> {
    const [owner, repo] = splitFullName(input.externalId);
    const octokit = new Octokit({ auth: input.accessToken });

    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: Number(input.pullRequestId),
      body: input.body,
    });
  }

  async listTree(input: ListTreeInput): Promise<GitTree | null> {
    const [owner, repo] = splitFullName(input.externalId);
    const octokit = new Octokit({ auth: input.accessToken });
    const path = normalizeTreePath(input.path);

    let data: unknown;
    try {
      ({ data } = await withRetry(
        () =>
          octokit.rest.repos.getContent({
            owner,
            repo,
            path,
            ref: input.ref,
          }),
        { shouldRetry: isRetryableReadError },
      ));
    } catch (error) {
      if (getStatus(error) === 404) return null;
      // Repo sem commit nenhum responde 409 na Contents API, igual à Git
      // Data API (ver commitFiles). Para a aba Code isso é "não há árvore",
      // não erro de infraestrutura.
      if (getStatus(error) === 409) return null;
      throw error;
    }

    // Caminho que resolve para um ARQUIVO devolve objeto, não lista — o
    // contrato manda `null` nesse caso.
    if (!Array.isArray(data)) return null;

    const entradas = data as {
      type: string;
      name: string;
      path: string;
      size?: number;
    }[];

    return {
      ref: input.ref,
      path,
      entries: entradas.slice(0, GIT_TREE_ENTRY_LIMIT).map((entrada) => ({
        path: entrada.path,
        name: entrada.name,
        // 'submodule' e 'symlink' existem no GitHub e não têm equivalente no
        // contrato. Viram 'file': são folhas, não descem — que é a única
        // coisa que a árvore precisa saber para navegar.
        type: entrada.type === 'dir' ? ('dir' as const) : ('file' as const),
        size: entrada.type === 'dir' ? null : (entrada.size ?? null),
      })),
      // A Contents API para diretório para em 1000 entradas por desenho da
      // própria API — o mesmo número de `GIT_TREE_ENTRY_LIMIT`, então o
      // corte é indistinguível e `truncated` cobre os dois.
      truncated: entradas.length > GIT_TREE_ENTRY_LIMIT,
    };
  }

  async getPullRequestDiff(
    input: GetPullRequestDiffInput,
  ): Promise<GitPullRequestDiff | null> {
    const [owner, repo] = splitFullName(input.externalId);
    const octokit = new Octokit({ auth: input.accessToken });
    const pullNumber = Number(input.pullRequestId);

    type ArquivoDaPr = Awaited<
      ReturnType<typeof octokit.rest.pulls.listFiles>
    >['data'][number];

    const arquivos: ArquivoDaPr[] = [];
    let page = 1;
    let truncated = false;

    // Paginação explícita, com teto: `octokit.paginate` puxaria TODAS as
    // páginas, e uma PR grande viraria dezenas de chamadas por abertura de
    // tela — o amplificador de tráfego que a FASE 26 proíbe.
    for (;;) {
      let pagina: ArquivoDaPr[];
      try {
        const resposta = await withRetry(
          () =>
            octokit.rest.pulls.listFiles({
              owner,
              repo,
              pull_number: pullNumber,
              per_page: 100,
              page,
            }),
          { shouldRetry: isRetryableReadError },
        );
        pagina = resposta.data;
      } catch (error) {
        if (getStatus(error) === 404) return null;
        throw error;
      }

      arquivos.push(...pagina);
      if (pagina.length < 100) break;
      if (arquivos.length >= GIT_DIFF_FILE_LIMIT) {
        truncated = true;
        break;
      }
      page += 1;
    }

    return {
      pullRequestId: input.pullRequestId,
      files: arquivos.slice(0, GIT_DIFF_FILE_LIMIT).map((arquivo) => ({
        path: arquivo.filename,
        previousPath: arquivo.previous_filename ?? null,
        status: STATUS_DO_GITHUB[arquivo.status] ?? 'modified',
        additions: arquivo.additions,
        deletions: arquivo.deletions,
        // `patch` vem AUSENTE para binário e para arquivo grande demais — é
        // exatamente o `null` do contrato, e por isso não vira string vazia.
        patch: arquivo.patch ?? null,
      })),
      truncated: truncated || arquivos.length > GIT_DIFF_FILE_LIMIT,
    };
  }

  async blame(input: BlameInput): Promise<GitBlame | null> {
    const [owner, repo] = splitFullName(input.externalId);
    const octokit = new Octokit({ auth: input.accessToken });

    let dados: BlameGraphqlResponse;
    try {
      dados = await octokit.graphql<BlameGraphqlResponse>(BLAME_QUERY, {
        owner,
        repo,
        expr: input.ref,
        path: input.path,
      });
    } catch (error) {
      if (isGraphqlNotFound(error)) return null;
      throw error;
    }

    // `object` é `null` pra ref/expressão que não resolve; `blame` some do
    // payload quando o alvo resolvido NÃO é commit (não deveria acontecer
    // pra branch/tag/sha de verdade, mas a união do GraphQL permite).
    const alvo = dados.repository?.object;
    if (!alvo?.blame) return null;

    const linhas: GitBlameLine[] = [];
    for (const faixa of alvo.blame.ranges) {
      for (let linha = faixa.startingLine; linha <= faixa.endingLine; linha++) {
        linhas.push({
          line: linha,
          commitSha: faixa.commit.oid,
          author: faixa.commit.author?.name ?? 'desconhecido',
          authorDate: faixa.commit.committedDate,
          summary: faixa.commit.message.split('\n')[0],
        });
      }
    }

    return {
      ref: input.ref,
      path: input.path,
      lines: linhas.slice(0, GIT_BLAME_LINE_LIMIT),
      truncated: linhas.length > GIT_BLAME_LINE_LIMIT,
    };
  }

  async listPullRequests(
    input: ListPullRequestsInput,
  ): Promise<GitPullRequestList> {
    const [owner, repo] = splitFullName(input.externalId);
    const octokit = new Octokit({ auth: input.accessToken });

    // A REST do GitHub só filtra por open/closed/all — "merged" não é estado
    // de LISTAGEM, é derivado de `merged_at` por item (abaixo). Pedir
    // `state: 'closed'` já cobre merged+closed-sem-merge; o filtro fino
    // acontece depois de normalizar.
    const stateNaListagem =
      input.state === 'merged' ? 'closed' : (input.state ?? 'all');

    let data: Awaited<ReturnType<typeof octokit.rest.pulls.list>>['data'];
    try {
      ({ data } = await withRetry(
        () =>
          octokit.rest.pulls.list({
            owner,
            repo,
            state: stateNaListagem,
            per_page: GIT_PR_LIST_LIMIT,
          }),
        { shouldRetry: isRetryableReadError },
      ));
    } catch (error) {
      if (getStatus(error) === 404)
        throw new GitRepoNotFoundError(input.externalId);
      throw error;
    }

    const itens: GitPullRequestSummary[] = data
      .map((pr): GitPullRequestSummary => ({
        id: String(pr.id),
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        author: pr.user?.login ?? null,
        state: pr.merged_at
          ? 'merged'
          : pr.state === 'open'
            ? 'open'
            : 'closed',
        sourceBranch: pr.head.ref,
        targetBranch: pr.base.ref,
        updatedAt: pr.updated_at,
      }))
      .filter((pr) => !input.state || pr.state === input.state);

    return {
      items: itens.slice(0, GIT_PR_LIST_LIMIT),
      truncated: data.length >= GIT_PR_LIST_LIMIT,
    };
  }

  async listBranchesDetailed(
    input: ListBranchesDetailedInput,
  ): Promise<GitBranchDetailList> {
    const [owner, repo] = splitFullName(input.externalId);
    const octokit = new Octokit({ auth: input.accessToken });

    const branches = await this.listBranches({
      externalId: input.externalId,
      accessToken: input.accessToken,
    });

    // UMA chamada pra achar PR aberta por branch de ORIGEM — não uma por
    // branch, senão o custo dobraria à toa (a comparação abaixo já é uma
    // chamada por branch).
    let prsAbertas: Awaited<ReturnType<typeof octokit.rest.pulls.list>>['data'];
    try {
      ({ data: prsAbertas } = await withRetry(
        () =>
          octokit.rest.pulls.list({
            owner,
            repo,
            state: 'open',
            per_page: GIT_PR_LIST_LIMIT,
          }),
        { shouldRetry: isRetryableReadError },
      ));
    } catch (error) {
      if (getStatus(error) === 404)
        throw new GitRepoNotFoundError(input.externalId);
      throw error;
    }
    const prPorBranch = new Map(prsAbertas.map((pr) => [pr.head.ref, pr]));

    const truncated = branches.length > GIT_BRANCH_DETAIL_LIMIT;
    const alvo = branches.slice(0, GIT_BRANCH_DETAIL_LIMIT);

    const items: GitBranchDetail[] = await Promise.all(
      alvo.map(async (branch) => {
        if (branch.name === input.defaultBranch) {
          return { ...branch, ahead: 0, behind: 0, pullRequest: null };
        }

        let ahead: number | null = null;
        let behind: number | null = null;
        try {
          const { data: comparacao } = await withRetry(
            () =>
              octokit.rest.repos.compareCommitsWithBasehead({
                owner,
                repo,
                basehead: `${input.defaultBranch}...${branch.name}`,
              }),
            { shouldRetry: isRetryableReadError },
          );
          ahead = comparacao.ahead_by;
          behind = comparacao.behind_by;
        } catch {
          // Comparação indisponível (branch órfã, histórico não relacionado)
          // — degradação honesta: `null`, nunca um número inventado.
        }

        const pr = prPorBranch.get(branch.name);
        return {
          ...branch,
          ahead,
          behind,
          pullRequest: pr
            ? { number: pr.number, state: 'open' as const }
            : null,
        };
      }),
    );

    return { items, truncated };
  }
}

/** `""` para a raiz — é o que a Contents API espera. */
function normalizeTreePath(path: string | undefined): string {
  return (path ?? '').replace(/^\.?\/+/, '').replace(/\/+$/, '');
}

// `copied` carrega `previous_filename` como `renamed`; `changed` e
// `unchanged` são variações de conteúdo alterado que o contrato não
// distingue.
const STATUS_DO_GITHUB: Record<string, GitDiffFileStatus> = {
  added: 'added',
  removed: 'removed',
  modified: 'modified',
  renamed: 'renamed',
  copied: 'renamed',
  changed: 'modified',
  unchanged: 'modified',
};

function splitFullName(externalId: string): [string, string] {
  const parts = externalId.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new GitRepoNotFoundError(externalId);
  }
  return [parts[0], parts[1]];
}

function getStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    return (error as { status?: unknown }).status as number | undefined;
  }
  return undefined;
}

function getResponseHeaders(
  error: unknown,
): Record<string, string> | undefined {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: unknown }).response;
    if (
      typeof response === 'object' &&
      response !== null &&
      'headers' in response
    ) {
      return (response as { headers?: unknown }).headers as
        Record<string, string> | undefined;
    }
  }
  return undefined;
}

function getBodyText(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: unknown }).response;
    if (
      typeof response === 'object' &&
      response !== null &&
      'data' in response
    ) {
      try {
        return JSON.stringify(response.data);
      } catch {
        return '';
      }
    }
  }
  return error instanceof Error ? error.message : '';
}

// GitHub sobrecarrega 403 pra permissão negada E rate-limit — só dá pra
// diferenciar pelo header, nunca só pelo status (ver docs/adr/0003).
function isRateLimited(error: unknown): boolean {
  return getResponseHeaders(error)?.['x-ratelimit-remaining'] === '0';
}

function isRetryableReadError(error: unknown): boolean {
  const status = getStatus(error);
  if (status === 429) return true;
  if (status !== undefined && status >= 500) return true;
  if (status === 403) return isRateLimited(error);
  return false;
}

/**
 * `object(expression:)` resolve branch/tag/sha uniformemente — o MESMO
 * vocabulário de `ref` que `getFileContent`/`listTree` já usam, ao contrário
 * de `ref(qualifiedName:)`, que só entende branch/tag. A REST do GitHub não
 * tem operação de blame nenhuma; é por isso que esta é a única operação do
 * provider que fala GraphQL.
 */
const BLAME_QUERY = `
  query($owner: String!, $repo: String!, $expr: String!, $path: String!) {
    repository(owner: $owner, name: $repo) {
      object(expression: $expr) {
        ... on Commit {
          blame(path: $path) {
            ranges {
              startingLine
              endingLine
              commit {
                oid
                message
                committedDate
                author { name }
              }
            }
          }
        }
      }
    }
  }
`;

interface BlameGraphqlResponse {
  repository: {
    object: {
      blame?: {
        ranges: {
          startingLine: number;
          endingLine: number;
          commit: {
            oid: string;
            message: string;
            committedDate: string;
            author: { name: string | null } | null;
          };
        }[];
      };
    } | null;
  } | null;
}

/**
 * GraphQL erra por CIMA do payload (`errors[]`), não por status HTTP — path
 * ou ref inexistente vira erro nomeado `NOT_FOUND` em vez de um `blame` nulo
 * no corpo. `octokit.graphql` propaga isso como `GraphqlResponseError`, e
 * checamos por duck-typing pra não depender do tipo exportado por
 * `@octokit/graphql` só pra isto.
 */
function isGraphqlNotFound(error: unknown): boolean {
  const errors = (error as { errors?: { type?: string; message?: string }[] })
    ?.errors;
  if (!errors) return false;
  return errors.some(
    (e) =>
      e.type === 'NOT_FOUND' ||
      /not found|could not resolve/i.test(e.message ?? ''),
  );
}
