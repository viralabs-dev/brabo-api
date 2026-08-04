import { Injectable } from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import type {
  CommitFilesInput,
  CreateBranchInput,
  CreateRepoInput,
  GetFileContentInput,
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
  CommentOnPullRequestInput,
} from '@brabo/shared';
import {
  GitBranchAlreadyExistsError,
  GitBranchNotFoundError,
  GitPermissionDeniedError,
  GitRepoAlreadyExistsError,
  GitRepoNotFoundError,
} from '../../domain/git/git-errors';
import { withRetry } from './retry';

/**
 * Implementa `GitProviderContract` (ver docs/adr/0001) — as 9 operações
 * normalizadas da Fase 2.
 */
@Injectable()
export class GithubProvider implements GitProviderContract {
  readonly name: GitProviderName = 'github';

  readonly capabilities: GitProviderCapabilities = {
    protectBranch: true,
    pullRequests: true,
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
}

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
