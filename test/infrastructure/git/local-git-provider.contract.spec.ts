import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalGitProvider } from '../../../src/infrastructure/git/local-git-provider';
import { runGitProviderContract } from '../../contract/git-provider.contract';
import {
  GitMergeConflictError,
  GitPullRequestAlreadyMergedError,
} from '../../../src/domain/git/git-errors';

const execFileAsync = promisify(execFile);

runGitProviderContract('local', async () => {
  const root = await mkdtemp(join(tmpdir(), 'brabo-git-repos-test-'));
  process.env.GIT_LOCAL_REPOS_ROOT = root;

  return {
    provider: new LocalGitProvider(),
    async makeUnwritableTarget() {
      await chmod(root, 0o000);
      return root;
    },
    async cleanup() {
      // chmod ANTES do rm — um diretório sem permissão de leitura/execução
      // faz `rm(recursive:true)` falhar silenciosamente e deixar lixo em
      // /tmp (o teste de permissão-negada é justamente quem chmoda a raiz).
      await chmod(root, 0o700).catch(() => {});
      await rm(root, { recursive: true, force: true });
    },
  };
});

// Cobertura extra, específica do LocalGitProvider — não faz parte do
// contrato genérico porque depende de inspecionar a árvore git via `git
// ls-tree`, algo que nenhuma das 8 operações normalizadas expõe. Existe
// pra confirmar que `commitFiles` faz `read-tree` do pai antes de aplicar
// os arquivos novos (sem isso, o segundo commit apagaria o primeiro).
describe('LocalGitProvider — commitFiles preserva árvore entre commits', () => {
  let root: string;
  let provider: LocalGitProvider;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'brabo-git-repos-test-'));
    process.env.GIT_LOCAL_REPOS_ROOT = root;
    provider = new LocalGitProvider();
  });

  afterEach(async () => {
    await chmod(root, 0o700).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });

  it('mantém arquivos de commits anteriores ao adicionar um novo', async () => {
    const repo = await provider.createRepo({
      name: 'preserva-arvore',
      visibility: 'private',
    });
    await provider.commitFiles({
      externalId: repo.externalId,
      branch: 'main',
      message: 'primeiro',
      files: [{ path: 'a.txt', content: 'a' }],
    });
    const second = await provider.commitFiles({
      externalId: repo.externalId,
      branch: 'main',
      message: 'segundo',
      files: [{ path: 'b.txt', content: 'b' }],
    });

    const { stdout } = await execFileAsync('git', [
      '--git-dir',
      repo.externalId,
      'ls-tree',
      '-r',
      '--name-only',
      second.sha,
    ]);
    expect(stdout.trim().split('\n').sort()).toEqual(['a.txt', 'b.txt']);
  });
});

// Fase 4a: PR local (store no sidecar + merge via git). O contrato genérico
// cobre openPullRequest (state 'open'); o merge de verdade é local-específico.
describe('LocalGitProvider — pull request local (open + merge)', () => {
  let root: string;
  let provider: LocalGitProvider;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'brabo-git-repos-test-'));
    process.env.GIT_LOCAL_REPOS_ROOT = root;
    provider = new LocalGitProvider();
  });

  afterEach(async () => {
    await chmod(root, 0o700).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });

  async function repoWithFeature() {
    const repo = await provider.createRepo({
      name: 'pr-flow',
      visibility: 'private',
    });
    await provider.commitFiles({
      externalId: repo.externalId,
      branch: 'main',
      message: 'base',
      files: [{ path: 'a.txt', content: 'a' }],
    });
    await provider.createBranch({
      externalId: repo.externalId,
      branchName: 'feature/x',
      fromRef: 'main',
    });
    const commit = await provider.commitFiles({
      externalId: repo.externalId,
      branch: 'feature/x',
      message: 'trabalho',
      files: [{ path: 'b.txt', content: 'b' }],
    });
    return { repo, featureSha: commit.sha };
  }

  it('abre e mescla uma PR — target avança pro commit da branch', async () => {
    const { repo, featureSha } = await repoWithFeature();

    const pr = await provider.openPullRequest({
      externalId: repo.externalId,
      sourceBranch: 'feature/x',
      targetBranch: 'main',
      title: 'Feature X',
    });
    expect(pr.state).toBe('open');
    expect(pr.url).toContain('/pull/');

    const merged = await provider.mergePullRequest({
      externalId: repo.externalId,
      pullRequestId: pr.id,
    });
    expect(merged.state).toBe('merged');

    // main agora aponta pro commit da feature (fast-forward).
    const branches = await provider.listBranches({
      externalId: repo.externalId,
    });
    expect(branches.find((b) => b.name === 'main')?.commitSha).toBe(featureSha);
  });

  it('grava o autor ao abrir e o devolve na listagem; sem autor segue null (RN-705)', async () => {
    const { repo } = await repoWithFeature();
    await provider.openPullRequest({
      externalId: repo.externalId,
      sourceBranch: 'feature/x',
      targetBranch: 'main',
      title: 'Com autor',
      author: 'dev-api[bot]',
    });
    await provider.openPullRequest({
      externalId: repo.externalId,
      sourceBranch: 'feature/x',
      targetBranch: 'main',
      title: 'Sem autor',
    });
    const lista = await provider.listPullRequests({
      externalId: repo.externalId,
    });
    expect(lista.items.map((p) => p.author)).toEqual(['dev-api[bot]', null]);
  });

  it('mergear de novo uma PR já mergeada é recusado com erro nomeado, e o target não se move (AT-249, RN-663)', async () => {
    const { repo, featureSha } = await repoWithFeature();
    const pr = await provider.openPullRequest({
      externalId: repo.externalId,
      sourceBranch: 'feature/x',
      targetBranch: 'main',
      title: 'Feature X',
    });
    await provider.mergePullRequest({
      externalId: repo.externalId,
      pullRequestId: pr.id,
    });

    await expect(
      provider.mergePullRequest({
        externalId: repo.externalId,
        pullRequestId: pr.id,
      }),
    ).rejects.toBeInstanceOf(GitPullRequestAlreadyMergedError);

    const branches = await provider.listBranches({
      externalId: repo.externalId,
    });
    expect(branches.find((b) => b.name === 'main')?.commitSha).toBe(featureSha);
  });

  async function duasPrsDoMesmoBase(b1: string, b2: string) {
    const repo = await provider.createRepo({
      name: 'diverge',
      visibility: 'private',
    });
    const id = repo.externalId;
    await provider.commitFiles({
      externalId: id,
      branch: 'main',
      message: 'base',
      files: [{ path: 'a.txt', content: 'a' }],
    });
    await provider.createBranch({
      externalId: id,
      branchName: 'feature/um',
      fromRef: 'main',
    });
    await provider.createBranch({
      externalId: id,
      branchName: 'feature/dois',
      fromRef: 'main',
    });
    const c1 = await provider.commitFiles({
      externalId: id,
      branch: 'feature/um',
      message: 'um',
      files: [{ path: b1, content: 'um' }],
    });
    const c2 = await provider.commitFiles({
      externalId: id,
      branch: 'feature/dois',
      message: 'dois',
      files: [{ path: b2, content: 'dois' }],
    });
    const pr1 = await provider.openPullRequest({
      externalId: id,
      sourceBranch: 'feature/um',
      targetBranch: 'main',
      title: 'Um',
    });
    const pr2 = await provider.openPullRequest({
      externalId: id,
      sourceBranch: 'feature/dois',
      targetBranch: 'main',
      title: 'Dois',
    });
    return { id, c1, c2, pr1, pr2 };
  }

  async function ehAncestral(id: string, a: string, b: string) {
    try {
      await execFileAsync('git', [
        '--git-dir',
        id,
        'merge-base',
        '--is-ancestor',
        a,
        b,
      ]);
      return true;
    } catch {
      return false;
    }
  }

  it('duas PRs divergentes sem conflito: os dois commits ficam no alvo, por commit de merge (AT-377, RN-704)', async () => {
    const { id, c1, c2, pr1, pr2 } = await duasPrsDoMesmoBase('b.txt', 'c.txt');
    await provider.mergePullRequest({ externalId: id, pullRequestId: pr1.id });
    const merged = await provider.mergePullRequest({
      externalId: id,
      pullRequestId: pr2.id,
    });
    expect(merged.state).toBe('merged');

    const main = (await provider.listBranches({ externalId: id })).find(
      (b) => b.name === 'main',
    )!.commitSha;
    expect(await ehAncestral(id, c1.sha, main)).toBe(true);
    expect(await ehAncestral(id, c2.sha, main)).toBe(true);
    const { stdout } = await execFileAsync('git', [
      '--git-dir',
      id,
      'log',
      '-1',
      '--format=%P%n%s',
      main,
    ]);
    const [pais, assunto] = stdout.trim().split('\n');
    expect(pais.split(' ')).toHaveLength(2);
    expect(assunto).toBe('Merge pull request #2 from feature/dois');
  });

  it('conflito: recusa nomeada com os arquivos, alvo intacto e PR aberta (AT-377, RN-704)', async () => {
    const { id, c1, pr1, pr2 } = await duasPrsDoMesmoBase('a.txt', 'a.txt');
    await provider.mergePullRequest({ externalId: id, pullRequestId: pr1.id });

    const erro = await provider
      .mergePullRequest({ externalId: id, pullRequestId: pr2.id })
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(GitMergeConflictError);
    expect((erro as GitMergeConflictError).conflictingFiles).toEqual(['a.txt']);

    const main = (await provider.listBranches({ externalId: id })).find(
      (b) => b.name === 'main',
    )!.commitSha;
    expect(main).toBe(c1.sha);
    const prs = await provider.listPullRequests({ externalId: id });
    expect(prs.items.find((p) => p.number === pr2.number)?.state).toBe('open');
  });

  it('openPullRequest rejeita branch inexistente', async () => {
    const { repo } = await repoWithFeature();
    await expect(
      provider.openPullRequest({
        externalId: repo.externalId,
        sourceBranch: 'nao-existe',
        targetBranch: 'main',
        title: 'x',
      }),
    ).rejects.toThrow();
  });
});
