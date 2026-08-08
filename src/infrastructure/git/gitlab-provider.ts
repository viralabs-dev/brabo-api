import { Injectable } from '@nestjs/common';
import { AccessLevel, Gitlab } from '@gitbeaker/rest';
import type {
  CommitFilesInput,
  CreateBranchInput,
  CreateRepoInput,
  GetFileContentInput,
  GetPullRequestDiffInput,
  GetRepoInput,
  GitBranch,
  GitCommitResult,
  GitDiffFileStatus,
  GitProviderCapabilities,
  GitProviderContract,
  GitProviderName,
  GitPullRequest,
  GitPullRequestDiff,
  GitRepo,
  GitTree,
  ListBranchesInput,
  ListTreeInput,
  MergePullRequestInput,
  OpenPullRequestInput,
  ProtectBranchInput,
  CommentOnPullRequestInput,
} from '@brabo/shared';
import {
  GIT_DIFF_FILE_LIMIT,
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
 * Implementa `GitProviderContract` (ver docs/adr/0001) — as 12 operações
 * normalizadas, das 9 da Fase 2 às duas de leitura da aba Code (FASE 26).
 * Usa `token:` (PAT de usuário) no construtor do
 * Gitbeaker — ver docs/adr/0004-git-credential-registration.md pra por
 * que isso não é intercambiável com `oauthToken:`.
 */
@Injectable()
export class GitlabProvider implements GitProviderContract {
  readonly name: GitProviderName = 'gitlab';

  readonly capabilities: GitProviderCapabilities = {
    protectBranch: true,
    pullRequests: true,
    listTree: true,
    pullRequestDiff: true,
  };

  async createRepo(input: CreateRepoInput): Promise<GitRepo> {
    const api = new Gitlab({ token: input.accessToken ?? '' });

    try {
      let namespaceId: number | undefined;
      if (input.namespace) {
        const namespace = await api.Namespaces.show(input.namespace);
        namespaceId = namespace.id;
      }

      const project = await api.Projects.create({
        name: input.name,
        namespaceId,
        visibility: input.visibility,
        initializeWithReadme: false,
      });

      return {
        externalId: project.path_with_namespace,
        name: input.name,
        url: project.http_url_to_repo,
        defaultBranch: project.default_branch ?? 'main',
        visibility: input.visibility,
      };
    } catch (error) {
      const status = getStatus(error);
      const message = getMessage(error);
      if (status === 400 && /already (exists|been taken)/i.test(message)) {
        throw new GitRepoAlreadyExistsError(input.name);
      }
      if (status === 401 || status === 403) {
        throw new GitPermissionDeniedError(input.name);
      }
      throw error;
    }
  }

  async getRepo(input: GetRepoInput): Promise<GitRepo> {
    const api = new Gitlab({ token: input.accessToken ?? '' });

    try {
      const project = await withRetry(
        () => api.Projects.show(input.externalId),
        {
          shouldRetry: isRetryableReadError,
        },
      );
      return {
        externalId: project.path_with_namespace,
        name: project.name,
        url: project.http_url_to_repo,
        // GitLab tem um 3º nível ('internal', visível a todo usuário
        // autenticado na instância) sem equivalente em GitRepo.visibility
        // — normaliza pro mais restritivo dos dois que temos.
        defaultBranch: project.default_branch ?? 'main',
        visibility: project.visibility === 'public' ? 'public' : 'private',
      };
    } catch (error) {
      if (getStatus(error) === 404)
        throw new GitRepoNotFoundError(input.externalId);
      if (getStatus(error) === 401 || getStatus(error) === 403) {
        throw new GitPermissionDeniedError(input.externalId);
      }
      throw error;
    }
  }

  async createBranch(input: CreateBranchInput): Promise<GitBranch> {
    const api = new Gitlab({ token: input.accessToken ?? '' });

    try {
      const branch = await api.Branches.create(
        input.externalId,
        input.branchName,
        input.fromRef,
      );
      return {
        name: branch.name,
        commitSha: branch.commit.id,
        protected: branch.protected,
      };
    } catch (error) {
      const status = getStatus(error);
      const message = getMessage(error);
      if (status === 404)
        throw new GitBranchNotFoundError(input.externalId, input.fromRef);
      if (status === 400 && /already (exists|been taken)/i.test(message)) {
        throw new GitBranchAlreadyExistsError(
          input.externalId,
          input.branchName,
        );
      }
      throw error;
    }
  }

  async protectBranch(input: ProtectBranchInput): Promise<void> {
    const api = new Gitlab({ token: input.accessToken ?? '' });

    try {
      // GitLab modela proteção como dois níveis de acesso — quem pode dar
      // push, quem pode fazer merge — bem mais simples que o GitHub, que
      // tem um payload rico de status-checks/revisores/enforce_admins
      // (ver github-provider.ts). Como `ProtectBranchInput` não carrega
      // configuração ainda, normalizamos pro mais restritivo disponível:
      // só Maintainer ou acima pode dar push ou merge nessa branch.
      //
      // A assimetria com o GitHub é o oposto da de lá: aqui NÃO há exigência
      // de aprovação nenhuma, então quem tem papel Maintainer faz merge direto
      // e a matriz do domínio (QA -> SecOps -> usuário) é o ÚNICO portão.
      // Decisão em docs/adr/0028.
      await api.ProtectedBranches.protect(input.externalId, input.branchName, {
        pushAccessLevel: AccessLevel.MAINTAINER,
        mergeAccessLevel: AccessLevel.MAINTAINER,
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

    const api = new Gitlab({ token: input.accessToken ?? '' });

    let branches: { name: string }[];
    try {
      branches = await api.Branches.all(input.externalId);
    } catch (error) {
      if (getStatus(error) === 404)
        throw new GitRepoNotFoundError(input.externalId);
      throw error;
    }

    const branchExists = branches.some(
      (branch) => branch.name === input.branch,
    );
    if (branches.length > 0 && !branchExists) {
      throw new GitBranchNotFoundError(input.externalId, input.branch);
    }

    let existingPaths = new Set<string>();
    if (branchExists) {
      const tree = await api.Repositories.allRepositoryTrees(input.externalId, {
        ref: input.branch,
        recursive: true,
      });
      existingPaths = new Set(tree.map((entry) => entry.path));
    }

    const actions = input.files.map((file) => ({
      action: existingPaths.has(file.path)
        ? ('update' as const)
        : ('create' as const),
      filePath: file.path,
      content: file.content,
    }));

    const commit = await api.Commits.create(
      input.externalId,
      input.branch,
      input.message,
      actions,
    );

    return { sha: commit.id, branch: input.branch };
  }

  async listBranches(input: ListBranchesInput): Promise<GitBranch[]> {
    const api = new Gitlab({ token: input.accessToken ?? '' });

    try {
      const branches = await withRetry(
        () => api.Branches.all(input.externalId),
        {
          shouldRetry: isRetryableReadError,
        },
      );
      return branches.map((branch) => ({
        name: branch.name,
        commitSha: branch.commit.id,
        protected: branch.protected,
      }));
    } catch (error) {
      if (getStatus(error) === 404)
        throw new GitRepoNotFoundError(input.externalId);
      throw error;
    }
  }

  async getFileContent(input: GetFileContentInput): Promise<string | null> {
    const api = new Gitlab({ token: input.accessToken ?? '' });

    try {
      const file = await api.RepositoryFiles.show(
        input.externalId,
        input.path,
        input.branch,
      );
      return Buffer.from(file.content, 'base64').toString('utf8');
    } catch (error) {
      if (getStatus(error) === 404) return null;
      throw error;
    }
  }

  async openPullRequest(input: OpenPullRequestInput): Promise<GitPullRequest> {
    const api = new Gitlab({ token: input.accessToken ?? '' });
    const mr = await api.MergeRequests.create(
      input.externalId,
      input.sourceBranch,
      input.targetBranch,
      input.title,
      { description: input.body },
    );

    return {
      id: String(mr.id),
      // GitLab distingue `iid` (número por-projeto, usado na URL/API) de
      // `id` (global) — `number` mapeia pro `iid`, não pro `id`.
      number: mr.iid,
      url: mr.web_url,
      sourceBranch: input.sourceBranch,
      targetBranch: input.targetBranch,
      state: 'open',
    };
  }

  async mergePullRequest(
    input: MergePullRequestInput,
  ): Promise<GitPullRequest> {
    const api = new Gitlab({ token: input.accessToken ?? '' });
    const mergeRequestIid = Number(input.pullRequestId);
    const mr = await api.MergeRequests.accept(
      input.externalId,
      mergeRequestIid,
    );

    return {
      id: String(mr.id),
      number: mr.iid,
      url: mr.web_url,
      sourceBranch: mr.source_branch,
      targetBranch: mr.target_branch,
      state: 'merged',
    };
  }

  async commentOnPullRequest(input: CommentOnPullRequestInput): Promise<void> {
    const api = new Gitlab({ token: input.accessToken ?? '' });
    const mergeRequestIid = Number(input.pullRequestId);
    await api.MergeRequestNotes.create(
      input.externalId,
      mergeRequestIid,
      input.body,
    );
  }

  async listTree(input: ListTreeInput): Promise<GitTree | null> {
    const api = new Gitlab({ token: input.accessToken ?? '' });
    const path = normalizeTreePath(input.path);

    let entradas: { id: string; name: string; type: string; path: string }[];
    try {
      entradas = await withRetry(
        () =>
          api.Repositories.allRepositoryTrees(input.externalId, {
            ref: input.ref,
            path,
            recursive: false,
            perPage: 100,
          }),
        { shouldRetry: isRetryableReadError },
      );
    } catch (error) {
      // O GitLab responde 404 tanto para projeto inexistente quanto para ref
      // ou caminho inexistente — todos `null` pelo contrato.
      if (getStatus(error) === 404) return null;
      throw error;
    }

    // Caminho que não existe (ou que é ARQUIVO) devolve lista VAZIA, com 200
    // — o GitLab não erra nesse caso. A raiz é a exceção: repositório sem
    // commit tem árvore vazia legítima, e `null` ali seria mentira.
    if (entradas.length === 0 && path !== '') return null;

    return {
      ref: input.ref,
      path,
      entries: entradas.slice(0, GIT_TREE_ENTRY_LIMIT).map((entrada) => ({
        path: entrada.path,
        name: entrada.name,
        // 'tree' é diretório; 'blob' e 'commit' (submódulo) são folhas.
        type: entrada.type === 'tree' ? ('dir' as const) : ('file' as const),
        // `RepositoryTreeSchema` NÃO traz tamanho — só o blob individual
        // traz, e pedi-lo por entrada faria uma requisição por arquivo.
        // `null` é a degradação honesta; a tela mostra a árvore sem bytes.
        size: null,
      })),
      truncated: entradas.length > GIT_TREE_ENTRY_LIMIT,
    };
  }

  async getPullRequestDiff(
    input: GetPullRequestDiffInput,
  ): Promise<GitPullRequestDiff | null> {
    const api = new Gitlab({ token: input.accessToken ?? '' });
    const mergeRequestIid = Number(input.pullRequestId);

    let diffs: {
      old_path: string;
      new_path: string;
      new_file: boolean;
      renamed_file: boolean;
      deleted_file: boolean;
      diff: string;
    }[];
    try {
      diffs = await withRetry(
        () => api.MergeRequests.allDiffs(input.externalId, mergeRequestIid),
        { shouldRetry: isRetryableReadError },
      );
    } catch (error) {
      if (getStatus(error) === 404) return null;
      throw error;
    }

    return {
      pullRequestId: input.pullRequestId,
      files: diffs.slice(0, GIT_DIFF_FILE_LIMIT).map((arquivo) => {
        const status = statusDoGitlab(arquivo);
        // `MergeRequestDiffSchema` NÃO traz additions/deletions — ao
        // contrário do GitHub, que já entrega os dois. Contar as linhas do
        // diff unificado é a única fonte disponível, e é exata: é o mesmo
        // que o `--numstat` faria sobre este texto.
        const { additions, deletions } = contarLinhas(arquivo.diff);
        return {
          path: arquivo.new_path,
          previousPath: status === 'renamed' ? arquivo.old_path : null,
          status,
          additions,
          deletions,
          // Binário vem com `diff` VAZIO (o GitLab não gera texto para ele).
          // `null` é o que o contrato manda — string vazia diria "sem
          // mudanças", que é falso.
          patch: arquivo.diff === '' ? null : arquivo.diff,
        };
      }),
      truncated: diffs.length > GIT_DIFF_FILE_LIMIT,
    };
  }
}

/** `""` para a raiz. */
function normalizeTreePath(path: string | undefined): string {
  return (path ?? '').replace(/^\.?\/+/, '').replace(/\/+$/, '');
}

function statusDoGitlab(arquivo: {
  new_file: boolean;
  renamed_file: boolean;
  deleted_file: boolean;
}): GitDiffFileStatus {
  if (arquivo.renamed_file) return 'renamed';
  if (arquivo.new_file) return 'added';
  if (arquivo.deleted_file) return 'removed';
  return 'modified';
}

/**
 * Conta `+`/`-` de um diff unificado, ignorando os cabeçalhos `+++`/`---`
 * (que começam com o mesmo caractere e não são linhas de conteúdo).
 */
function contarLinhas(diff: string): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const linha of diff.split('\n')) {
    if (linha.startsWith('+++') || linha.startsWith('---')) continue;
    if (linha.startsWith('+')) additions += 1;
    else if (linha.startsWith('-')) deletions += 1;
  }
  return { additions, deletions };
}

function getStatus(error: unknown): number | undefined {
  const response = (error as { cause?: { response?: { status?: number } } })
    ?.cause?.response;
  return response?.status;
}

function getMessage(error: unknown): string {
  const cause = (error as { cause?: { description?: unknown } })?.cause;
  if (cause && typeof cause.description === 'string') return cause.description;
  return error instanceof Error ? error.message : '';
}

// Gitbeaker JÁ retenta 429/502 internamente (backoff exponencial sem
// jitter, até 10 tentativas — ver docs/adr/0003). Retentar esses códigos
// de novo aqui dobraria o delay; nosso wrapper só cobre timeout e outros
// 5xx que o Gitbeaker não trata.
function isRetryableReadError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'GitbeakerTimeoutError')
    return true;
  const status = getStatus(error);
  return status === 500 || status === 503 || status === 504;
}
