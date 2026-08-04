import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { GithubProvider } from '../../../src/infrastructure/git/github-provider';
import {
  GitBranchNotFoundError,
  GitPermissionDeniedError,
  GitRepoAlreadyExistsError,
  GitRepoNotFoundError,
} from '../../../src/domain/git/git-errors';
import { runGitProviderContract } from '../../contract/git-provider.contract';
import { FakeRepoStore } from '../../support/msw/fake-repo-store';
import { createGithubHandlers } from '../../support/msw/github-fake-backend';
import { withAccessToken } from './support/with-access-token';

const store = new FakeRepoStore();
const server = setupServer(...createGithubHandlers(store));

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

runGitProviderContract('github (mockado)', () =>
  Promise.resolve({
    provider: withAccessToken(new GithubProvider(), 'fake-token'),
    cleanup: () => {
      store.reset();
      return Promise.resolve();
    },
  }),
);

// Cenários de HTTP específicos (403/404/422/429) — a suite compartilhada
// não cobre isso (é sobre comportamento normalizado, não sobre transporte
// HTTP), então ficam aqui, igual o describe extra do LocalGitProvider.
describe('GithubProvider — cenários de HTTP mockados', () => {
  afterEach(() => {
    store.reset();
  });

  /**
   * O primeiro commit num repositório recém-criado.
   *
   * O GitHub cria com `auto_init: false` — repo sem commit nenhum —, e aí
   * QUALQUER leitura de ref responde `409 Git Repository is empty`, não 404.
   * O provider já tinha o caminho de primeiro commit, guardado por 404, e por
   * isso ele nunca era alcançado: o bootstrap de Gitflow morria no passo 1
   * ("Commit do template de PR") em todo projeto GitHub novo. Verificado
   * contra a API viva antes de existir este teste.
   */
  it('repo VAZIO (409) aceita o primeiro commit, sem consultar refs de novo', async () => {
    const provider = withAccessToken(new GithubProvider(), 'fake-token');
    const repo = await provider.createRepo({
      name: 'recem-criado',
      visibility: 'private',
    });

    const commit = await provider.commitFiles({
      externalId: repo.externalId,
      branch: 'main',
      message: 'chore: template de PR',
      files: [{ path: '.github/PULL_REQUEST_TEMPLATE.md', content: '## O quê' }],
    });

    expect(commit.branch).toBe('main');
    expect(commit.sha).toBeTruthy();

    // E a branch passa a existir: o commit sem pai criou o ref.
    const branches = await provider.listBranches({ externalId: repo.externalId });
    expect(branches.map((b) => b.name)).toContain('main');
  });

  /**
   * O 409 não pode virar "aceita qualquer branch": num repo que JÁ tem refs, o
   * GitHub responde 404 para branch inexistente, e aí a distinção volta a
   * importar — senão um erro de digitação no nome da branch criaria uma nova.
   */
  it('branch inexistente num repo COM refs continua sendo erro', async () => {
    const provider = withAccessToken(new GithubProvider(), 'fake-token');
    const repo = await provider.createRepo({
      name: 'com-historico',
      visibility: 'private',
    });
    await provider.commitFiles({
      externalId: repo.externalId,
      branch: 'main',
      message: 'chore: primeiro',
      files: [{ path: 'README.md', content: '# oi' }],
    });

    await expect(
      provider.commitFiles({
        externalId: repo.externalId,
        branch: 'nao-existe',
        message: 'chore: segundo',
        files: [{ path: 'outro.md', content: 'x' }],
      }),
    ).rejects.toThrow(GitBranchNotFoundError);
  });

  it('404 num repositório inexistente vira GitRepoNotFoundError', async () => {
    const provider = withAccessToken(new GithubProvider(), 'fake-token');
    await expect(
      provider.getRepo({ externalId: 'octocat/nao-existe' }),
    ).rejects.toThrow(GitRepoNotFoundError);
  });

  it('422 "already exists" na criação vira GitRepoAlreadyExistsError', async () => {
    const provider = withAccessToken(new GithubProvider(), 'fake-token');
    await provider.createRepo({
      name: 'duplicado-http',
      visibility: 'private',
    });
    await expect(
      provider.createRepo({ name: 'duplicado-http', visibility: 'private' }),
    ).rejects.toThrow(GitRepoAlreadyExistsError);
  });

  it('403 sem cabeçalho de rate-limit vira GitPermissionDeniedError', async () => {
    server.use(
      http.post('https://api.github.com/user/repos', () =>
        HttpResponse.json({ message: 'Forbidden' }, { status: 403 }),
      ),
    );
    const provider = withAccessToken(new GithubProvider(), 'fake-token');
    await expect(
      provider.createRepo({ name: 'sem-permissao', visibility: 'private' }),
    ).rejects.toThrow(GitPermissionDeniedError);
  });

  it('429 numa leitura (getRepo) é retentado até suceder', async () => {
    const repo = store.createRepo(
      'octocat/retry-read',
      'retry-read',
      'private',
    );
    let calls = 0;
    server.use(
      http.get('https://api.github.com/repos/:owner/:repo', () => {
        calls += 1;
        if (calls < 3)
          return HttpResponse.json(
            { message: 'rate limited' },
            { status: 429 },
          );
        return HttpResponse.json({
          full_name: repo.fullName,
          name: repo.name,
          clone_url: `https://github.com/${repo.fullName}.git`,
          html_url: `https://github.com/${repo.fullName}`,
          default_branch: repo.defaultBranch,
          private: true,
        });
      }),
    );
    const provider = withAccessToken(new GithubProvider(), 'fake-token');
    const result = await provider.getRepo({ externalId: repo.fullName });
    expect(result.externalId).toBe(repo.fullName);
    expect(calls).toBeGreaterThan(1);
  });

  it('429 numa mutação (createRepo) rejeita na primeira tentativa, sem retry', async () => {
    let calls = 0;
    server.use(
      http.post('https://api.github.com/user/repos', () => {
        calls += 1;
        return HttpResponse.json({ message: 'rate limited' }, { status: 429 });
      }),
    );
    const provider = withAccessToken(new GithubProvider(), 'fake-token');
    await expect(
      provider.createRepo({
        name: 'mutacao-rate-limited',
        visibility: 'private',
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('createBranch: fromRef inexistente vira GitBranchNotFoundError (404)', async () => {
    store.createRepo('octocat/branch-404', 'branch-404', 'private');
    const provider = withAccessToken(new GithubProvider(), 'fake-token');
    await expect(
      provider.createBranch({
        externalId: 'octocat/branch-404',
        branchName: 'feature',
        fromRef: 'main',
      }),
    ).rejects.toThrow(GitBranchNotFoundError);
  });
});
