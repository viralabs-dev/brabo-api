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
 * `GitProviderContract`. Nesta sessão só `LocalGitProvider` é exercitado
 * (ver test/infrastructure/git/local-git-provider.contract.spec.ts); uma
 * sessão futura (Github/Gitlab) reutiliza esta função sem modificação,
 * só trocando o harness.
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
