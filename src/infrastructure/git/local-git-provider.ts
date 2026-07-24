import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, join } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
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
} from '@brabo/shared';
import {
  GitProvider,
  type CreateRepositoryInput,
  type CreateRepositoryResult,
} from '../../application/ports/git-provider.port';
import {
  GitBranchAlreadyExistsError,
  GitBranchNotFoundError,
  GitNotSupportedError,
  GitPermissionDeniedError,
  GitRepoAlreadyExistsError,
  GitRepoNotFoundError,
} from '../../domain/git/git-errors';

const execFileAsync = promisify(execFile);

/**
 * Repo bare vazio — sem lib de git nova, só `git init --bare` via
 * child_process. É suficiente como conceito de "repositório provisionado":
 * clonável, push funcional, equivalente a um repo vazio via API do
 * GitHub/GitLab com auto_init desabilitado. Deliberadamente sem commit
 * inicial/README, pra "provisionado" ter o mesmo significado nos 3
 * providers.
 *
 * Implementa DOIS contratos: `GitProvider` (abstract class de DI do Nest,
 * usada hoje pelo pipeline de provisionamento — `createRepository` fica
 * intocada, byte a byte) e `GitProviderContract` (novo, normalizado, ver
 * @brabo/shared e docs/adr/0001) — as 8 operações da Fase 2. Os dois
 * coexistem deliberadamente nesta sessão; GithubProvider/GitlabProvider
 * ainda não implementam o segundo (ver docs/adr/0001).
 */
@Injectable()
export class LocalGitProvider implements GitProvider, GitProviderContract {
  readonly name: GitProviderName = 'local';

  // Nem branch protection nem pull requests fazem sentido pra um bare
  // repo local — não há plataforma por trás pra hospedar isso.
  readonly capabilities: GitProviderCapabilities = {
    protectBranch: false,
    pullRequests: false,
  };

  async createRepository(
    input: CreateRepositoryInput,
  ): Promise<CreateRepositoryResult> {
    const root = process.env.GIT_LOCAL_REPOS_ROOT ?? '/tmp/brabo-git-repos';
    const dirName = `${sanitizeSlug(input.name)}.git`;
    const absolutePath = join(root, dirName);

    await execFileAsync('git', ['init', '--bare', absolutePath]);

    return {
      externalId: absolutePath,
      url: `file://${absolutePath}`,
      defaultBranch: 'main',
    };
  }

  async createRepo(input: CreateRepoInput): Promise<GitRepo> {
    const root = process.env.GIT_LOCAL_REPOS_ROOT ?? '/tmp/brabo-git-repos';
    const dirName = `${sanitizeSlug(input.name)}.git`;
    const absolutePath = join(root, dirName);

    try {
      await mkdir(root, { recursive: true });
      await mkdir(absolutePath, { recursive: false });
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'EEXIST')
        throw new GitRepoAlreadyExistsError(absolutePath);
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        throw new GitPermissionDeniedError(absolutePath);
      }
      throw error;
    }

    await initBareRepo(absolutePath);

    return {
      externalId: absolutePath,
      name: input.name,
      url: `file://${absolutePath}`,
      defaultBranch: 'main',
      visibility: input.visibility,
    };
  }

  async getRepo(input: GetRepoInput): Promise<GitRepo> {
    const repoDir = input.externalId;
    await assertBareRepo(repoDir);

    const { stdout } = await execGit(repoDir, [
      'symbolic-ref',
      '--short',
      'HEAD',
    ]);

    return {
      externalId: repoDir,
      name: basename(repoDir).replace(/\.git$/, ''),
      url: `file://${repoDir}`,
      defaultBranch: stdout.trim(),
      // Bare repo local não tem conceito de visibilidade — não existe
      // plataforma por trás controlando acesso. Fixo em 'private' porque
      // é a suposição mais segura, nunca refletido em lugar nenhum.
      visibility: 'private',
    };
  }

  async createBranch(input: CreateBranchInput): Promise<GitBranch> {
    const repoDir = input.externalId;
    await assertBareRepo(repoDir);

    const sha = await resolveRef(repoDir, input.fromRef);
    if (!sha) throw new GitBranchNotFoundError(repoDir, input.fromRef);

    try {
      // old-value '' = CAS exigindo que a ref ainda não exista.
      await execGit(repoDir, [
        'update-ref',
        `refs/heads/${input.branchName}`,
        sha,
        '',
      ]);
    } catch (error) {
      if (isAlreadyExists(error)) {
        throw new GitBranchAlreadyExistsError(repoDir, input.branchName);
      }
      throw error;
    }

    return { name: input.branchName, commitSha: sha, protected: false };
  }

  protectBranch(): Promise<void> {
    return Promise.reject(new GitNotSupportedError(this.name, 'protectBranch'));
  }

  async commitFiles(input: CommitFilesInput): Promise<GitCommitResult> {
    if (input.files.length === 0) {
      throw new Error('commitFiles requer ao menos um arquivo em `files`');
    }

    const repoDir = input.externalId;
    await assertBareRepo(repoDir);

    const refs = await listRefMap(repoDir);
    const parentSha = refs.get(input.branch);
    if (refs.size > 0 && parentSha === undefined) {
      throw new GitBranchNotFoundError(repoDir, input.branch);
    }

    const scratchIndex = join(repoDir, `.brabo-index-${randomUUID()}`);
    const env = {
      ...process.env,
      GIT_INDEX_FILE: scratchIndex,
      GIT_AUTHOR_NAME: 'Brabo Bot',
      GIT_AUTHOR_EMAIL: 'bot@brabo.dev',
      GIT_COMMITTER_NAME: 'Brabo Bot',
      GIT_COMMITTER_EMAIL: 'bot@brabo.dev',
    };

    try {
      if (parentSha) {
        // Carrega a árvore do pai no índice-rascunho primeiro — senão o
        // commit novo conteria SÓ os arquivos de `files`, apagando tudo
        // que já existia na branch.
        await execFileAsync(
          'git',
          ['--git-dir', repoDir, 'read-tree', parentSha],
          { env },
        );
      }

      for (const file of input.files) {
        const blobSha = await hashObjectFromContent(repoDir, file.content, env);
        await execFileAsync(
          'git',
          [
            '--git-dir',
            repoDir,
            'update-index',
            '--add',
            '--cacheinfo',
            `100644,${blobSha},${file.path}`,
          ],
          { env },
        );
      }

      const { stdout: treeOut } = await execFileAsync(
        'git',
        ['--git-dir', repoDir, 'write-tree'],
        { env },
      );
      const treeSha = treeOut.trim();

      const commitArgs = [
        '--git-dir',
        repoDir,
        'commit-tree',
        treeSha,
        '-m',
        input.message,
      ];
      if (parentSha) commitArgs.push('-p', parentSha);
      const { stdout: commitOut } = await execFileAsync('git', commitArgs, {
        env,
      });
      const newSha = commitOut.trim();

      await execGit(repoDir, [
        'update-ref',
        `refs/heads/${input.branch}`,
        newSha,
        parentSha ?? '',
      ]);

      return { sha: newSha, branch: input.branch };
    } finally {
      await rm(scratchIndex, { force: true });
    }
  }

  async listBranches(input: ListBranchesInput): Promise<GitBranch[]> {
    const repoDir = input.externalId;
    await assertBareRepo(repoDir);

    const refs = await listRefMap(repoDir);
    return Array.from(refs.entries()).map(([name, commitSha]) => ({
      name,
      commitSha,
      protected: false,
    }));
  }

  openPullRequest(): Promise<GitPullRequest> {
    return Promise.reject(
      new GitNotSupportedError(this.name, 'openPullRequest'),
    );
  }

  // Quando o bootstrap de Gitflow (fase futura) precisar mesclar branches
  // num provider sem `pullRequests` (como este), ele precisa de uma
  // operação de merge direto ainda não modelada aqui — ver
  // docs/adr/0001-git-provider-contract-shape.md. `mergePullRequest`
  // continua estritamente sobre pull requests de verdade.
  mergePullRequest(): Promise<GitPullRequest> {
    return Promise.reject(
      new GitNotSupportedError(this.name, 'mergePullRequest'),
    );
  }
}

async function initBareRepo(path: string): Promise<void> {
  await execFileAsync('git', ['init', '--bare', path]);
  // Força o branch default independente da versão/config do git do
  // host (init.defaultBranch pode não existir ou apontar pra outro nome).
  await execFileAsync('git', [
    '--git-dir',
    path,
    'symbolic-ref',
    'HEAD',
    'refs/heads/main',
  ]);
}

async function execGit(repoDir: string, args: string[]) {
  return execFileAsync('git', ['--git-dir', repoDir, ...args]);
}

async function assertBareRepo(repoDir: string): Promise<void> {
  try {
    const { stdout } = await execGit(repoDir, [
      'rev-parse',
      '--is-bare-repository',
    ]);
    if (stdout.trim() !== 'true') throw new Error('not a bare repository');
  } catch {
    throw new GitRepoNotFoundError(repoDir);
  }
}

async function resolveRef(
  repoDir: string,
  ref: string,
): Promise<string | null> {
  try {
    const { stdout } = await execGit(repoDir, [
      'rev-parse',
      '--verify',
      '--quiet',
      `${ref}^{commit}`,
    ]);
    return stdout.trim();
  } catch {
    return null;
  }
}

async function listRefMap(repoDir: string): Promise<Map<string, string>> {
  const { stdout } = await execGit(repoDir, [
    'for-each-ref',
    '--format=%(refname:short) %(objectname)',
    'refs/heads/',
  ]);
  const refs = new Map<string, string>();
  for (const line of stdout.trim().split('\n').filter(Boolean)) {
    const [name, sha] = line.split(' ');
    refs.set(name, sha);
  }
  return refs;
}

async function hashObjectFromContent(
  repoDir: string,
  content: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const promise = execFileAsync(
    'git',
    ['--git-dir', repoDir, 'hash-object', '-w', '--stdin'],
    { env },
  );
  promise.child.stdin?.end(content, 'utf8');
  const { stdout } = await promise;
  return stdout.trim();
}

function isAlreadyExists(error: unknown): boolean {
  const stderr = (error as { stderr?: string })?.stderr ?? '';
  return /already exists/i.test(stderr);
}

function sanitizeSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
