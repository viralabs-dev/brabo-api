import { Injectable } from '@nestjs/common';
import { AccessLevel, Gitlab } from '@gitbeaker/rest';
import type {
  CommitFilesInput,
  CreateBranchInput,
  CreateRepoInput,
  GetRepoInput,
  GitBranch,
  GitCommitResult,
  GitProviderCapabilities,
  GitProviderContract,
  GitProviderName,
  GitPullRequest,
  GitRepo,
  ListBranchesInput,
  MergePullRequestInput,
  OpenPullRequestInput,
  ProtectBranchInput,
} from '@brabo/shared';
import {
  GitProvider,
  type CreateRepositoryInput,
  type CreateRepositoryResult,
} from '../../application/ports/git-provider.port';
import { GitProviderAuthError } from '../../domain/git/git-provider-errors';
import {
  GitBranchAlreadyExistsError,
  GitBranchNotFoundError,
  GitPermissionDeniedError,
  GitRepoAlreadyExistsError,
  GitRepoNotFoundError,
} from '../../domain/git/git-errors';
import { withRetry } from './retry';

/**
 * Implementa DOIS contratos, igual LocalGitProvider (ver docs/adr/0001):
 * `GitProvider` (DI antiga, `createRepository` intocada — continua
 * usando `oauthToken`, único caminho que a alimenta hoje) e
 * `GitProviderContract` (8 operações normalizadas, novo — usa `token:`,
 * PAT de usuário, ver docs/adr/0004-git-credential-registration.md pra
 * por que os dois NÃO são intercambiáveis no construtor do Gitbeaker).
 */
@Injectable()
export class GitlabProvider implements GitProvider, GitProviderContract {
  readonly name: GitProviderName = 'gitlab';

  readonly capabilities: GitProviderCapabilities = {
    protectBranch: true,
    pullRequests: true,
  };

  async createRepository(
    input: CreateRepositoryInput,
  ): Promise<CreateRepositoryResult> {
    if (!input.accessToken) {
      throw new GitProviderAuthError('gitlab', 'Token de acesso ausente');
    }
    const api = new Gitlab({ oauthToken: input.accessToken });

    try {
      // A API de criação de projeto do GitLab pede namespace_id numérico,
      // não o path direto — resolve o namespace antes de criar.
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
        url: project.http_url_to_repo,
        defaultBranch: project.default_branch ?? 'main',
      };
    } catch (error) {
      if (isAuthError(error)) {
        throw new GitProviderAuthError(
          'gitlab',
          'Token do GitLab inválido ou revogado',
        );
      }
      throw error;
    }
  }

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

function isAuthError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'cause' in error &&
    typeof error.cause === 'object' &&
    error.cause !== null &&
    'response' in error.cause &&
    typeof error.cause.response === 'object' &&
    error.cause.response !== null &&
    'status' in error.cause.response &&
    (error.cause.response.status === 401 || error.cause.response.status === 403)
  );
}
