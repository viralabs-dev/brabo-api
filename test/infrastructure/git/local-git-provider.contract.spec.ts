import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalGitProvider } from '../../../src/infrastructure/git/local-git-provider';
import { runGitProviderContract } from '../../contract/git-provider.contract';

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
    const repo = await provider.createRepo({ name: 'preserva-arvore', visibility: 'private' });
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
