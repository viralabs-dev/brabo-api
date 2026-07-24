import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { GitlabProvider } from '../../../src/infrastructure/git/gitlab-provider';
import {
  GitBranchNotFoundError,
  GitPermissionDeniedError,
  GitRepoAlreadyExistsError,
  GitRepoNotFoundError,
} from '../../../src/domain/git/git-errors';
import { runGitProviderContract } from '../../contract/git-provider.contract';
import { FakeRepoStore } from '../../support/msw/fake-repo-store';
import { createGitlabHandlers } from '../../support/msw/gitlab-fake-backend';
import { withAccessToken } from './support/with-access-token';

const store = new FakeRepoStore();
const server = setupServer(...createGitlabHandlers(store));

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

runGitProviderContract('gitlab (mockado)', () =>
  Promise.resolve({
    provider: withAccessToken(new GitlabProvider(), 'fake-token'),
    cleanup: () => {
      store.reset();
      return Promise.resolve();
    },
  }),
);

// Cenários de HTTP específicos (401/403/404/400/429/5xx) — igual o describe
// extra do GithubProvider: a suite compartilhada é sobre comportamento
// normalizado, não sobre transporte HTTP.
describe('GitlabProvider — cenários de HTTP mockados', () => {
  afterEach(() => {
    store.reset();
  });

  it('404 num repositório inexistente vira GitRepoNotFoundError', async () => {
    const provider = withAccessToken(new GitlabProvider(), 'fake-token');
    await expect(
      provider.getRepo({ externalId: 'acme/nao-existe' }),
    ).rejects.toThrow(GitRepoNotFoundError);
  });

  it('400 "already been taken" na criação vira GitRepoAlreadyExistsError', async () => {
    const provider = withAccessToken(new GitlabProvider(), 'fake-token');
    await provider.createRepo({
      name: 'duplicado-http',
      visibility: 'private',
    });
    await expect(
      provider.createRepo({ name: 'duplicado-http', visibility: 'private' }),
    ).rejects.toThrow(GitRepoAlreadyExistsError);
  });

  it('403 na criação vira GitPermissionDeniedError', async () => {
    server.use(
      http.post('https://gitlab.com/api/v4/projects', () =>
        HttpResponse.json({ message: '403 Forbidden' }, { status: 403 }),
      ),
    );
    const provider = withAccessToken(new GitlabProvider(), 'fake-token');
    await expect(
      provider.createRepo({ name: 'sem-permissao', visibility: 'private' }),
    ).rejects.toThrow(GitPermissionDeniedError);
  });

  it('503 numa leitura (getRepo) é retentado pelo NOSSO wrapper até suceder', async () => {
    const repo = store.createRepo('acme/retry-read', 'retry-read', 'private');
    let calls = 0;
    server.use(
      http.get('https://gitlab.com/api/v4/projects/:id', () => {
        calls += 1;
        if (calls < 3)
          return HttpResponse.json(
            { message: 'indisponível' },
            { status: 503 },
          );
        return HttpResponse.json({
          id: 1,
          path_with_namespace: repo.fullName,
          name: repo.name,
          http_url_to_repo: `https://gitlab.com/${repo.fullName}.git`,
          default_branch: repo.defaultBranch,
          visibility: 'private',
        });
      }),
    );
    const provider = withAccessToken(new GitlabProvider(), 'fake-token');
    const result = await provider.getRepo({ externalId: repo.fullName });
    expect(result.externalId).toBe(repo.fullName);
    expect(calls).toBeGreaterThan(1);
  });

  it('500 numa mutação (createRepo) rejeita na primeira tentativa, sem retry', async () => {
    // 500 fica de fora tanto do nosso `isRetryableReadError` (mutação nunca
    // passa por `withRetry`, ver docs/adr/0003) quanto da lista de retry
    // embutida no transporte do Gitbeaker (`retryCodes = [429, 502]`,
    // hardcoded em @gitbeaker/rest — ver ADR). É o único status que prova
    // "mutação nunca retenta" das DUAS camadas ao mesmo tempo; 429/502
    // numa mutação SERIAM retentados pelo Gitbeaker mesmo assim, fora do
    // nosso controle (ver teste seguinte).
    let calls = 0;
    server.use(
      http.post('https://gitlab.com/api/v4/projects', () => {
        calls += 1;
        return HttpResponse.json({ message: 'erro interno' }, { status: 500 });
      }),
    );
    const provider = withAccessToken(new GitlabProvider(), 'fake-token');
    await expect(
      provider.createRepo({ name: 'mutacao-sem-retry', visibility: 'private' }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('429 numa mutação (createRepo): o Gitbeaker retenta por conta própria, fora do nosso wrapper', async () => {
    // Documenta um comportamento real que FOGE do nosso controle: o
    // transporte do Gitbeaker retenta 429/502 pra QUALQUER verbo HTTP,
    // não só leituras — não há opção pública pra desligar isso (ver
    // docs/adr/0003). Não é o `withRetry` daqui que retenta (mutações
    // nunca passam por ele); é a própria lib. Delay real mas curto
    // (`2**i * 0.25s` — só 0.25s pra 1 retry), sem precisar de fake timers.
    let calls = 0;
    server.use(
      http.post('https://gitlab.com/api/v4/projects', () => {
        calls += 1;
        if (calls < 2)
          return HttpResponse.json(
            { message: 'rate limited' },
            { status: 429 },
          );
        return HttpResponse.json(
          {
            id: 1,
            path_with_namespace: 'acme/retry-do-gitbeaker',
            name: 'retry-do-gitbeaker',
            http_url_to_repo: 'https://gitlab.com/acme/retry-do-gitbeaker.git',
            default_branch: 'main',
            visibility: 'private',
          },
          { status: 201 },
        );
      }),
    );
    const provider = withAccessToken(new GitlabProvider(), 'fake-token');
    const result = await provider.createRepo({
      name: 'retry-do-gitbeaker',
      visibility: 'private',
    });
    expect(result.externalId).toBe('acme/retry-do-gitbeaker');
    expect(calls).toBe(2);
  });

  it('createBranch: fromRef inexistente vira GitBranchNotFoundError (404)', async () => {
    store.createRepo('acme/branch-404', 'branch-404', 'private');
    const provider = withAccessToken(new GitlabProvider(), 'fake-token');
    await expect(
      provider.createBranch({
        externalId: 'acme/branch-404',
        branchName: 'feature',
        fromRef: 'main',
      }),
    ).rejects.toThrow(GitBranchNotFoundError);
  });
});
