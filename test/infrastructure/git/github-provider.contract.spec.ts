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
