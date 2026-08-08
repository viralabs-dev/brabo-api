import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, join } from 'node:path';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
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
  GitPullRequestDiffFile,
  GitRepo,
  GitTree,
  GitTreeEntry,
  ListBranchesInput,
  ListTreeInput,
  OpenPullRequestInput,
  MergePullRequestInput,
  CommentOnPullRequestInput,
} from '@brabo/shared';
import {
  GIT_DIFF_FILE_LIMIT,
  GIT_TREE_ENTRY_LIMIT,
} from '../../domain/git/git-read-limits';
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
 * Implementa `GitProviderContract` (ver @brabo/shared e docs/adr/0001) —
 * as 12 operações normalizadas, das 9 da Fase 2 às duas de leitura da aba
 * Code (FASE 26).
 */
@Injectable()
export class LocalGitProvider implements GitProviderContract {
  readonly name: GitProviderName = 'local';

  // Branch protection continua sem sentido (não há plataforma). Pull requests
  // ganham suporte LOCAL (Fase 4a — devs): um store leve num sidecar do bare
  // repo + merge via git, pra o fluxo dos dev agents rodar 100% self-contained
  // (ver docs/adr/0011). O contrato único cobre PR no local a partir daqui.
  // `listTree` sai de `git ls-tree` e `getPullRequestDiff` de `git diff`
  // entre as branches guardadas no store de PR — as duas rodam no bare repo,
  // sem plataforma nenhuma por trás, e por isso são declaradas `true`: a
  // suite de contrato as exercita de ponta a ponta neste provider.
  readonly capabilities: GitProviderCapabilities = {
    protectBranch: false,
    pullRequests: true,
    listTree: true,
    pullRequestDiff: true,
  };

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

  async getFileContent(input: GetFileContentInput): Promise<string | null> {
    const repoDir = input.externalId;
    await assertBareRepo(repoDir);

    try {
      const { stdout } = await execGit(repoDir, [
        'show',
        `${input.branch}:${input.path}`,
      ]);
      return stdout;
    } catch (error) {
      if (isMissingRefOrPath(error)) return null;
      throw error;
    }
  }

  async openPullRequest(input: OpenPullRequestInput): Promise<GitPullRequest> {
    const repoDir = input.externalId;
    await assertBareRepo(repoDir);

    if ((await resolveRef(repoDir, input.sourceBranch)) === null) {
      throw new GitBranchNotFoundError(repoDir, input.sourceBranch);
    }
    if ((await resolveRef(repoDir, input.targetBranch)) === null) {
      throw new GitBranchNotFoundError(repoDir, input.targetBranch);
    }

    const store = await readPrStore(repoDir);
    const number = store.length + 1;
    const record: StoredPr = {
      id: `pr-${number}`,
      number,
      title: input.title,
      sourceBranch: input.sourceBranch,
      targetBranch: input.targetBranch,
      state: 'open',
    };
    store.push(record);
    await writePrStore(repoDir, store);

    return toPullRequest(repoDir, record);
  }

  async mergePullRequest(
    input: MergePullRequestInput,
  ): Promise<GitPullRequest> {
    const repoDir = input.externalId;
    await assertBareRepo(repoDir);

    const store = await readPrStore(repoDir);
    const record = store.find((p) => p.id === input.pullRequestId);
    if (!record) {
      throw new GitNotSupportedError(
        this.name,
        'mergePullRequest: PR não encontrada',
      );
    }

    if (record.state === 'open') {
      const sourceSha = await resolveRef(repoDir, record.sourceBranch);
      if (sourceSha === null) {
        throw new GitBranchNotFoundError(repoDir, record.sourceBranch);
      }
      // Merge local simplista: avança o target pro commit da branch da PR
      // (fast-forward). Suficiente pro fluxo self-contained dos dev agents;
      // divergência real do target não é exercitada aqui.
      await execGit(repoDir, [
        'update-ref',
        `refs/heads/${record.targetBranch}`,
        sourceSha,
      ]);
      record.state = 'merged';
      await writePrStore(repoDir, store);
    }

    return toPullRequest(repoDir, record);
  }

  async commentOnPullRequest(input: CommentOnPullRequestInput): Promise<void> {
    const repoDir = input.externalId;
    await assertBareRepo(repoDir);

    const store = await readPrStore(repoDir);
    const record = store.find((p) => p.id === input.pullRequestId);
    if (!record) {
      throw new GitNotSupportedError(
        this.name,
        'commentOnPullRequest: PR não encontrada',
      );
    }

    record.comments = [...(record.comments ?? []), input.body];
    await writePrStore(repoDir, store);
  }

  async listTree(input: ListTreeInput): Promise<GitTree | null> {
    const repoDir = input.externalId;
    await assertBareRepo(repoDir);

    const path = normalizeTreePath(input.path);
    // `ls-tree <ref> -- <dir>/` lista UM nível. O sufixo `/` é o que faz o
    // git tratar o argumento como diretório a abrir em vez de entrada a
    // casar — sem ele, `ls-tree HEAD -- src` devolve a própria `src`, e a
    // árvore nunca desceria.
    const spec = path === '' ? [] : ['--', `${path}/`];

    let stdout: string;
    try {
      ({ stdout } = await execGit(repoDir, [
        'ls-tree',
        '-l',
        '-z',
        `${input.ref}^{tree}`,
        ...spec,
      ]));
    } catch (error) {
      if (isMissingRefOrPath(error)) return null;
      throw error;
    }

    const linhas = stdout.split('\0').filter(Boolean);
    // Caminho que não existe, ou que é ARQUIVO: `ls-tree -- <arquivo>/` não
    // casa nada e sai com zero. A raiz é a exceção — repositório sem commit
    // tem árvore vazia legítima, e aí `null` seria mentira.
    if (linhas.length === 0 && path !== '') return null;

    const entries: GitTreeEntry[] = [];
    for (const linha of linhas.slice(0, GIT_TREE_ENTRY_LIMIT)) {
      // `<mode> <type> <sha> <size>\t<path>` — size é `-` para árvore.
      const [meta, entryPath] = linha.split('\t');
      const campos = meta.trim().split(/\s+/);
      const tipo = campos[1];
      const tamanho = campos[3];
      entries.push({
        path: entryPath,
        name: entryPath.slice(entryPath.lastIndexOf('/') + 1),
        type: tipo === 'tree' ? 'dir' : 'file',
        size: tipo === 'blob' && tamanho !== '-' ? Number(tamanho) : null,
      });
    }

    return {
      ref: input.ref,
      path,
      entries,
      truncated: linhas.length > GIT_TREE_ENTRY_LIMIT,
    };
  }

  async getPullRequestDiff(
    input: GetPullRequestDiffInput,
  ): Promise<GitPullRequestDiff | null> {
    const repoDir = input.externalId;
    await assertBareRepo(repoDir);

    const store = await readPrStore(repoDir);
    const record = store.find((p) => p.id === input.pullRequestId);
    if (!record) return null;

    // `a...b` é o diff contra a MERGE BASE, não contra a ponta do target —
    // é o que a plataforma mostra numa PR. Contra a ponta, commits que
    // entraram no target depois da branch apareceriam invertidos no diff.
    const range = `${record.targetBranch}...${record.sourceBranch}`;

    const numstat = await execGit(repoDir, [
      'diff',
      '-M',
      '-z',
      '--numstat',
      range,
    ]);
    const nameStatus = await execGit(repoDir, [
      'diff',
      '-M',
      '-z',
      '--name-status',
      range,
    ]);

    const statusPorCaminho = parseNameStatusZ(nameStatus.stdout);
    const contagens = parseNumstatZ(numstat.stdout);

    const files: GitPullRequestDiffFile[] = [];
    for (const contagem of contagens.slice(0, GIT_DIFF_FILE_LIMIT)) {
      const status = statusPorCaminho.get(contagem.path) ?? 'modified';
      const { stdout: patch } = await execGit(repoDir, [
        'diff',
        '-M',
        range,
        '--',
        contagem.path,
      ]);
      files.push({
        path: contagem.path,
        previousPath: status === 'renamed' ? contagem.previousPath : null,
        status,
        additions: contagem.additions,
        deletions: contagem.deletions,
        // Binário: o numstat vem com `-` nas duas contagens e o patch não
        // tem hunk nenhum. `null` diz "não veio", que é o contrato.
        patch: contagem.binary ? null : patch,
      });
    }

    return {
      pullRequestId: record.id,
      files,
      truncated: contagens.length > GIT_DIFF_FILE_LIMIT,
    };
  }
}

/** `""` para a raiz; sem `/` na ponta, sem `./`. */
function normalizeTreePath(path: string | undefined): string {
  return (path ?? '').replace(/^\.?\/+/, '').replace(/\/+$/, '');
}

interface ContagemDeArquivo {
  path: string;
  previousPath: string | null;
  additions: number;
  deletions: number;
  binary: boolean;
}

/**
 * `git diff -z --numstat` emite `adds\tdels\t\0<path>\0` e, para renomeação,
 * `adds\tdels\t\0<antigo>\0<novo>\0` — três campos em vez de dois. É por isso
 * que o parse é por NUL e não por linha: sem `-z`, uma renomeação vira
 * `{antigo => novo}` numa string só, e caminho com espaço/chave quebra o
 * desempate.
 */
function parseNumstatZ(stdout: string): ContagemDeArquivo[] {
  const campos = stdout.split('\0');
  const resultado: ContagemDeArquivo[] = [];

  let i = 0;
  while (i < campos.length) {
    const cabecalho = campos[i];
    if (!cabecalho) break;
    const [adds, dels, restoNaMesmaCelula] = cabecalho.split('\t');
    const binary = adds === '-' && dels === '-';

    // Sem renomeação o path vem colado no 3º pedaço do cabeçalho; com
    // renomeação esse pedaço é vazio e os dois caminhos vêm nos NULs
    // seguintes.
    if (restoNaMesmaCelula) {
      resultado.push({
        path: restoNaMesmaCelula,
        previousPath: null,
        additions: binary ? 0 : Number(adds),
        deletions: binary ? 0 : Number(dels),
        binary,
      });
      i += 1;
      continue;
    }

    const anterior = campos[i + 1];
    const novo = campos[i + 2];
    resultado.push({
      path: novo,
      previousPath: anterior,
      additions: binary ? 0 : Number(adds),
      deletions: binary ? 0 : Number(dels),
      binary,
    });
    i += 3;
  }

  return resultado;
}

/** `git diff -z --name-status`: `<letra>\0<path>\0` (ou `R<score>` com dois). */
function parseNameStatusZ(stdout: string): Map<string, GitDiffFileStatus> {
  const campos = stdout.split('\0').filter((c) => c !== '');
  const mapa = new Map<string, GitDiffFileStatus>();

  let i = 0;
  while (i < campos.length) {
    const letra = campos[i][0];
    if (letra === 'R' || letra === 'C') {
      mapa.set(campos[i + 2], 'renamed');
      i += 3;
      continue;
    }
    mapa.set(campos[i + 1], STATUS_POR_LETRA[letra] ?? 'modified');
    i += 2;
  }

  return mapa;
}

const STATUS_POR_LETRA: Record<string, GitDiffFileStatus> = {
  A: 'added',
  D: 'removed',
  M: 'modified',
};

interface StoredPr {
  id: string;
  number: number;
  title: string;
  sourceBranch: string;
  targetBranch: string;
  state: 'open' | 'merged' | 'closed';
  comments?: string[];
}

function prStorePath(repoDir: string): string {
  return join(repoDir, 'brabo-prs.json');
}

async function readPrStore(repoDir: string): Promise<StoredPr[]> {
  try {
    return JSON.parse(
      await readFile(prStorePath(repoDir), 'utf8'),
    ) as StoredPr[];
  } catch {
    return [];
  }
}

async function writePrStore(repoDir: string, store: StoredPr[]): Promise<void> {
  await writeFile(prStorePath(repoDir), JSON.stringify(store, null, 2), 'utf8');
}

function toPullRequest(repoDir: string, pr: StoredPr): GitPullRequest {
  return {
    id: pr.id,
    number: pr.number,
    url: `local://${basename(repoDir)}/pull/${pr.number}`,
    sourceBranch: pr.sourceBranch,
    targetBranch: pr.targetBranch,
    state: pr.state,
  };
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

// `git show <branch>:<path>` erra de duas formas distintas pro nosso caso
// "não existe" (branch inexistente vs. path ausente na árvore) — ambas
// mapeiam pro mesmo `null` do contrato (ver GetFileContentInput).
//
// `git ls-tree <ref>^{tree}` (listTree) erra numa TERCEIRA forma para ref
// inexistente: `fatal: Not a valid object name`. Verificado contra o git do
// ambiente antes de entrar aqui — "not a valid" não casa com "invalid", e
// sem esta alternativa a ref inexistente vazaria como erro cru em vez de
// virar o `null` que o contrato promete.
function isMissingRefOrPath(error: unknown): boolean {
  const stderr = (error as { stderr?: string })?.stderr ?? '';
  return /does not exist in|invalid object name|not a valid object name/i.test(
    stderr,
  );
}

function sanitizeSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
