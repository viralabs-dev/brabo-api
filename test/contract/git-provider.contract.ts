import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GitProviderContract } from '@brabo/shared';
import {
  GitBranchAlreadyExistsError,
  GitBranchNotFoundError,
  GitNotSupportedError,
  GitPermissionDeniedError,
  GitRepoAlreadyExistsError,
  GitRepoNotFoundError,
} from '../../src/domain/git/git-errors';

/**
 * Suite de CONTRATO única (ver CLAUDE.md e docs/adr/0001) — roda a MESMA
 * bateria de asserções contra qualquer implementação de
 * `GitProviderContract`.
 *
 * Quem a exercita hoje, cinco invocações em cinco arquivos:
 *
 * - `test/infrastructure/git/local-git-provider.contract.spec.ts`
 * - `test/infrastructure/git/github-provider.contract.spec.ts` (mockado)
 * - `test/infrastructure/git/github-provider.smoke.spec.ts` (API real, gated)
 * - `test/infrastructure/git/gitlab-provider.contract.spec.ts` (mockado)
 * - `test/infrastructure/git/gitlab-provider.smoke.spec.ts` (API real, gated)
 *
 * A previsão original — "uma sessão futura reutiliza esta função sem
 * modificação, só trocando o harness" — se cumpriu na Fase 2, e o cabeçalho
 * não acompanhou: era o achado #8 do primeiro dogfooding. A lista acima é
 * travada por `test/contract/git-provider-contract-callers.spec.ts`, para não
 * apodrecer de novo.
 */
export interface GitProviderContractHarness {
  provider: GitProviderContract;
  /**
   * Deixa o alvo usado pela PRÓXIMA chamada de `createRepo` sem permissão
   * de escrita, retornando um identificador do que foi alterado (pra
   * diagnóstico) — ou `undefined` se o harness não conseguir simular isso
   * no ambiente atual (ex.: rodando como root, onde chmod não bloqueia
   * nada).
   */
  makeUnwritableTarget?: () => Promise<string | undefined>;
  cleanup: () => Promise<void>;
}

const isRoot = process.getuid?.() === 0;

export function runGitProviderContract(
  label: string,
  makeHarness: () => Promise<GitProviderContractHarness>,
) {
  describe(`GitProviderContract — ${label}`, () => {
    let harness: GitProviderContractHarness;
    let provider: GitProviderContract;

    beforeEach(async () => {
      harness = await makeHarness();
      provider = harness.provider;
    });

    afterEach(async () => {
      await harness.cleanup();
    });

    it('createRepo: cria um repositório novo', async () => {
      const repo = await provider.createRepo({
        name: 'contrato repo',
        visibility: 'private',
      });
      expect(repo.externalId).toBeTruthy();
      expect(repo.defaultBranch).toBe('main');
      expect(repo.visibility).toBe('private');
    });

    it('createRepo: rejeita nome já usado com GitRepoAlreadyExistsError', async () => {
      await provider.createRepo({ name: 'duplicado', visibility: 'private' });
      await expect(
        provider.createRepo({ name: 'duplicado', visibility: 'private' }),
      ).rejects.toThrow(GitRepoAlreadyExistsError);
    });

    it('getRepo: retorna o repo criado', async () => {
      const created = await provider.createRepo({
        name: 'consulta',
        visibility: 'private',
      });
      const found = await provider.getRepo({ externalId: created.externalId });
      expect(found.externalId).toBe(created.externalId);
      expect(found.defaultBranch).toBe('main');
    });

    it('getRepo: rejeita id inexistente com GitRepoNotFoundError', async () => {
      await expect(
        provider.getRepo({
          externalId: '/definitivamente/nao/existe/repo.git',
        }),
      ).rejects.toThrow(GitRepoNotFoundError);
    });

    it('commitFiles: cria o primeiro commit numa branch nova', async () => {
      const repo = await provider.createRepo({
        name: 'commit-happy',
        visibility: 'private',
      });
      const result = await provider.commitFiles({
        externalId: repo.externalId,
        branch: 'main',
        message: 'primeiro commit',
        files: [{ path: 'README.md', content: '# hello\n' }],
      });
      expect(result.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(result.branch).toBe('main');
    });

    it('commitFiles: segundo commit na mesma branch produz um sha novo', async () => {
      const repo = await provider.createRepo({
        name: 'commit-second',
        visibility: 'private',
      });
      const first = await provider.commitFiles({
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
      expect(second.sha).not.toBe(first.sha);
    });

    it('getFileContent: retorna o conteúdo do arquivo commitado', async () => {
      const repo = await provider.createRepo({
        name: 'get-file-content',
        visibility: 'private',
      });
      await provider.commitFiles({
        externalId: repo.externalId,
        branch: 'main',
        message: 'commit com arquivo',
        files: [{ path: 'docs/policy.md', content: '# política\n' }],
      });

      const content = await provider.getFileContent({
        externalId: repo.externalId,
        branch: 'main',
        path: 'docs/policy.md',
      });
      expect(content).toBe('# política\n');
    });

    it('getFileContent: retorna null pra arquivo inexistente', async () => {
      const repo = await provider.createRepo({
        name: 'get-file-content-missing-path',
        visibility: 'private',
      });
      await provider.commitFiles({
        externalId: repo.externalId,
        branch: 'main',
        message: 'commit sem o arquivo procurado',
        files: [{ path: 'a.txt', content: 'a' }],
      });

      const content = await provider.getFileContent({
        externalId: repo.externalId,
        branch: 'main',
        path: 'nao-existe.md',
      });
      expect(content).toBeNull();
    });

    it('getFileContent: retorna null pra branch inexistente', async () => {
      const repo = await provider.createRepo({
        name: 'get-file-content-missing-branch',
        visibility: 'private',
      });

      const content = await provider.getFileContent({
        externalId: repo.externalId,
        branch: 'nao-existe',
        path: 'a.txt',
      });
      expect(content).toBeNull();
    });

    it('commitFiles: rejeita branch inexistente (repo com refs, branch nova) com GitBranchNotFoundError', async () => {
      const repo = await provider.createRepo({
        name: 'commit-missing-branch',
        visibility: 'private',
      });
      await provider.commitFiles({
        externalId: repo.externalId,
        branch: 'main',
        message: 'primeiro',
        files: [{ path: 'a.txt', content: 'a' }],
      });
      await expect(
        provider.commitFiles({
          externalId: repo.externalId,
          branch: 'nao-existe',
          message: 'x',
          files: [{ path: 'b.txt', content: 'b' }],
        }),
      ).rejects.toThrow(GitBranchNotFoundError);
    });

    it('createBranch: cria a partir de uma ref existente', async () => {
      const repo = await provider.createRepo({
        name: 'branch-happy',
        visibility: 'private',
      });
      await provider.commitFiles({
        externalId: repo.externalId,
        branch: 'main',
        message: 'commit inicial',
        files: [{ path: 'README.md', content: '# oi\n' }],
      });

      const branch = await provider.createBranch({
        externalId: repo.externalId,
        branchName: 'feature/x',
        fromRef: 'main',
      });

      expect(branch.name).toBe('feature/x');
      expect(branch.commitSha).toMatch(/^[0-9a-f]{40}$/);
    });

    it('createBranch: rejeita fromRef inexistente com GitBranchNotFoundError', async () => {
      const repo = await provider.createRepo({
        name: 'branch-missing-ref',
        visibility: 'private',
      });
      await expect(
        provider.createBranch({
          externalId: repo.externalId,
          branchName: 'feature/x',
          fromRef: 'main',
        }),
      ).rejects.toThrow(GitBranchNotFoundError);
    });

    it('createBranch: rejeita nome já existente com GitBranchAlreadyExistsError', async () => {
      const repo = await provider.createRepo({
        name: 'branch-duplicada',
        visibility: 'private',
      });
      await provider.commitFiles({
        externalId: repo.externalId,
        branch: 'main',
        message: 'inicial',
        files: [{ path: 'a.txt', content: 'a' }],
      });
      await provider.createBranch({
        externalId: repo.externalId,
        branchName: 'dev',
        fromRef: 'main',
      });
      await expect(
        provider.createBranch({
          externalId: repo.externalId,
          branchName: 'dev',
          fromRef: 'main',
        }),
      ).rejects.toThrow(GitBranchAlreadyExistsError);
    });

    it('listBranches: lista as branches existentes', async () => {
      const repo = await provider.createRepo({
        name: 'list-branches',
        visibility: 'private',
      });
      await provider.commitFiles({
        externalId: repo.externalId,
        branch: 'main',
        message: 'inicial',
        files: [{ path: 'a.txt', content: 'a' }],
      });
      await provider.createBranch({
        externalId: repo.externalId,
        branchName: 'dev',
        fromRef: 'main',
      });

      const branches = await provider.listBranches({
        externalId: repo.externalId,
      });
      expect(branches.map((b) => b.name).sort()).toEqual(['dev', 'main']);
    });

    it('protectBranch: respeita capabilities.protectBranch', async () => {
      const repo = await provider.createRepo({
        name: 'protect',
        visibility: 'private',
      });
      await provider.commitFiles({
        externalId: repo.externalId,
        branch: 'main',
        message: 'inicial',
        files: [{ path: 'a.txt', content: 'a' }],
      });

      if (provider.capabilities.protectBranch) {
        await provider.protectBranch({
          externalId: repo.externalId,
          branchName: 'main',
        });
        const branches = await provider.listBranches({
          externalId: repo.externalId,
        });
        expect(branches.find((b) => b.name === 'main')?.protected).toBe(true);
      } else {
        await expect(
          provider.protectBranch({
            externalId: repo.externalId,
            branchName: 'main',
          }),
        ).rejects.toThrow(GitNotSupportedError);
      }
    });

    it('openPullRequest: respeita capabilities.pullRequests', async () => {
      const repo = await provider.createRepo({
        name: 'pr-open',
        visibility: 'private',
      });
      await provider.commitFiles({
        externalId: repo.externalId,
        branch: 'main',
        message: 'inicial',
        files: [{ path: 'a.txt', content: 'a' }],
      });
      await provider.createBranch({
        externalId: repo.externalId,
        branchName: 'feature',
        fromRef: 'main',
      });

      const input = {
        externalId: repo.externalId,
        sourceBranch: 'feature',
        targetBranch: 'main',
        title: 'PR de teste',
      };

      if (provider.capabilities.pullRequests) {
        const pr = await provider.openPullRequest(input);
        expect(pr.state).toBe('open');
      } else {
        await expect(provider.openPullRequest(input)).rejects.toThrow(
          GitNotSupportedError,
        );
      }
    });

    it('commentOnPullRequest: respeita capabilities.pullRequests', async () => {
      const repo = await provider.createRepo({
        name: 'pr-comment',
        visibility: 'private',
      });

      if (!provider.capabilities.pullRequests) {
        await expect(
          provider.commentOnPullRequest({
            externalId: repo.externalId,
            pullRequestId: 'nao-existe',
            body: 'parecer de teste',
          }),
        ).rejects.toThrow(GitNotSupportedError);
        return;
      }

      await provider.commitFiles({
        externalId: repo.externalId,
        branch: 'main',
        message: 'inicial',
        files: [{ path: 'a.txt', content: 'a' }],
      });
      await provider.createBranch({
        externalId: repo.externalId,
        branchName: 'feature',
        fromRef: 'main',
      });
      const pr = await provider.openPullRequest({
        externalId: repo.externalId,
        sourceBranch: 'feature',
        targetBranch: 'main',
        title: 'PR de teste',
      });

      await expect(
        provider.commentOnPullRequest({
          externalId: repo.externalId,
          pullRequestId: pr.id,
          body: 'parecer de teste',
        }),
      ).resolves.toBeUndefined();
    });

    it('mergePullRequest: respeita capabilities.pullRequests', async () => {
      const repo = await provider.createRepo({
        name: 'pr-merge',
        visibility: 'private',
      });

      if (provider.capabilities.pullRequests) {
        // Sessão futura (Github/Gitlab): abrir e mesclar um PR de verdade.
        return;
      }

      await expect(
        provider.mergePullRequest({
          externalId: repo.externalId,
          pullRequestId: 'nao-existe',
        }),
      ).rejects.toThrow(GitNotSupportedError);
    });

    // --- listTree (11ª operação, FASE 26) ---

    it('listTree: respeita capabilities.listTree e lista UM nível da raiz', async () => {
      const repo = await provider.createRepo({
        name: 'tree-raiz',
        visibility: 'private',
      });
      await provider.commitFiles({
        externalId: repo.externalId,
        branch: 'main',
        message: 'inicial',
        files: [
          { path: 'README.md', content: '# oi\n' },
          { path: 'src/a.ts', content: 'export const a = 1;\n' },
          { path: 'src/lib/b.ts', content: 'export const b = 2;\n' },
        ],
      });

      const input = { externalId: repo.externalId, ref: 'main' };

      if (!provider.capabilities.listTree) {
        await expect(provider.listTree(input)).rejects.toThrow(
          GitNotSupportedError,
        );
        return;
      }

      const tree = await provider.listTree(input);
      expect(tree).not.toBeNull();
      expect(tree!.path).toBe('');
      expect(tree!.truncated).toBe(false);

      // UM nível: `src` aparece como diretório, `src/a.ts` NÃO aparece aqui.
      const porCaminho = new Map(tree!.entries.map((e) => [e.path, e]));
      expect(porCaminho.get('README.md')?.type).toBe('file');
      expect(porCaminho.get('README.md')?.name).toBe('README.md');
      expect(porCaminho.get('src')?.type).toBe('dir');
      expect(porCaminho.has('src/a.ts')).toBe(false);
      // Diretório nunca tem tamanho — é o que separa folha de galho na tela.
      expect(porCaminho.get('src')?.size).toBeNull();
    });

    it('listTree: desce um nível e devolve o caminho completo de cada entrada', async () => {
      if (!provider.capabilities.listTree) return;

      const repo = await provider.createRepo({
        name: 'tree-subdir',
        visibility: 'private',
      });
      await provider.commitFiles({
        externalId: repo.externalId,
        branch: 'main',
        message: 'inicial',
        files: [
          { path: 'src/a.ts', content: 'a\n' },
          { path: 'src/lib/b.ts', content: 'b\n' },
        ],
      });

      const tree = await provider.listTree({
        externalId: repo.externalId,
        ref: 'main',
        path: 'src',
      });

      expect(tree).not.toBeNull();
      expect(tree!.path).toBe('src');
      const porCaminho = new Map(tree!.entries.map((e) => [e.path, e]));
      // `path` é sempre completo a partir da raiz; `name` é só a folha.
      expect(porCaminho.get('src/a.ts')?.name).toBe('a.ts');
      expect(porCaminho.get('src/lib')?.type).toBe('dir');
    });

    it('listTree: retorna null pra ref inexistente', async () => {
      if (!provider.capabilities.listTree) return;

      const repo = await provider.createRepo({
        name: 'tree-ref-ausente',
        visibility: 'private',
      });
      await provider.commitFiles({
        externalId: repo.externalId,
        branch: 'main',
        message: 'inicial',
        files: [{ path: 'a.txt', content: 'a' }],
      });

      await expect(
        provider.listTree({
          externalId: repo.externalId,
          ref: 'nao-existe',
        }),
      ).resolves.toBeNull();
    });

    it('listTree: retorna null pra caminho inexistente e pra caminho que é ARQUIVO', async () => {
      if (!provider.capabilities.listTree) return;

      const repo = await provider.createRepo({
        name: 'tree-path-ausente',
        visibility: 'private',
      });
      await provider.commitFiles({
        externalId: repo.externalId,
        branch: 'main',
        message: 'inicial',
        files: [{ path: 'README.md', content: '# oi\n' }],
      });

      await expect(
        provider.listTree({
          externalId: repo.externalId,
          ref: 'main',
          path: 'nao/existe',
        }),
      ).resolves.toBeNull();

      // Arquivo NÃO é árvore — devolver as entradas do pai aqui faria a tela
      // "abrir" um arquivo como se fosse pasta.
      await expect(
        provider.listTree({
          externalId: repo.externalId,
          ref: 'main',
          path: 'README.md',
        }),
      ).resolves.toBeNull();
    });

    // --- getPullRequestDiff (12ª operação, FASE 26) ---

    it('getPullRequestDiff: respeita capabilities.pullRequestDiff', async () => {
      const repo = await provider.createRepo({
        name: 'diff-basico',
        visibility: 'private',
      });

      if (!provider.capabilities.pullRequestDiff) {
        await expect(
          provider.getPullRequestDiff({
            externalId: repo.externalId,
            pullRequestId: 'nao-existe',
          }),
        ).rejects.toThrow(GitNotSupportedError);
        return;
      }
      if (!provider.capabilities.pullRequests) return;

      await provider.commitFiles({
        externalId: repo.externalId,
        branch: 'main',
        message: 'inicial',
        files: [{ path: 'README.md', content: 'linha um\n' }],
      });
      await provider.createBranch({
        externalId: repo.externalId,
        branchName: 'feature',
        fromRef: 'main',
      });
      await provider.commitFiles({
        externalId: repo.externalId,
        branch: 'feature',
        message: 'mudanças',
        files: [
          { path: 'README.md', content: 'linha um\nlinha dois\n' },
          { path: 'novo.txt', content: 'nasceu\n' },
        ],
      });
      const pr = await provider.openPullRequest({
        externalId: repo.externalId,
        sourceBranch: 'feature',
        targetBranch: 'main',
        title: 'PR de diff',
      });

      const diff = await provider.getPullRequestDiff({
        externalId: repo.externalId,
        pullRequestId: pr.id,
      });

      expect(diff).not.toBeNull();
      expect(diff!.pullRequestId).toBe(pr.id);
      expect(diff!.truncated).toBe(false);

      const porCaminho = new Map(diff!.files.map((f) => [f.path, f]));

      const modificado = porCaminho.get('README.md');
      expect(modificado?.status).toBe('modified');
      expect(modificado?.additions).toBe(1);
      expect(modificado?.deletions).toBe(0);
      expect(modificado?.previousPath).toBeNull();
      // Patch de arquivo de TEXTO alterado nunca é `null` — `null` é
      // reservado a binário/omitido, e confundir os dois faz a tela dizer
      // "sem conteúdo" para uma mudança que existe.
      expect(typeof modificado?.patch).toBe('string');
      expect(modificado?.patch).toContain('linha dois');

      expect(porCaminho.get('novo.txt')?.status).toBe('added');
      expect(porCaminho.get('novo.txt')?.additions).toBe(1);
    });

    it('getPullRequestDiff: retorna null pra PR inexistente', async () => {
      if (!provider.capabilities.pullRequestDiff) return;

      const repo = await provider.createRepo({
        name: 'diff-pr-ausente',
        visibility: 'private',
      });
      await provider.commitFiles({
        externalId: repo.externalId,
        branch: 'main',
        message: 'inicial',
        files: [{ path: 'a.txt', content: 'a' }],
      });

      await expect(
        provider.getPullRequestDiff({
          externalId: repo.externalId,
          // Numérico de propósito: Github/Gitlab convertem o id pra número, e
          // um id não-numérico viraria NaN e mascararia o 404 real.
          pullRequestId: '4242',
        }),
      ).resolves.toBeNull();
    });

    // Containers da api rodam como root em dev (ver docker/api/Dockerfile) —
    // root ignora permissões Unix, então chmod não reproduz EACCES real.
    // Pulado nesse caso em vez de fingir que passou.
    it.skipIf(isRoot)(
      'createRepo: rejeita permissão negada com GitPermissionDeniedError',
      async () => {
        if (!harness.makeUnwritableTarget) return;
        const target = await harness.makeUnwritableTarget();
        if (!target) return;

        await expect(
          provider.createRepo({ name: 'sem-permissao', visibility: 'private' }),
        ).rejects.toThrow(GitPermissionDeniedError);
      },
    );
  });
}
