import { http, HttpResponse } from 'msw';
import type { FakeRepoStore } from './fake-repo-store';

const BASE = 'https://gitlab.com/api/v4';

// Shapes/rotas confirmados empiricamente (Gitbeaker não documenta URLs
// publicamente estáveis) instrumentando `@gitbeaker/rest` com um handler
// catch-all do msw e inspecionando `request.url`/body de cada chamada
// usada por `gitlab-provider.ts`. Dois detalhes que não são óbvios pela
// leitura do client:
// - O id do projeto (`path_with_namespace`, com `/`) vai SEMPRE
//   URL-encoded num único segmento (`encodeURIComponent`) — nunca como
//   dois segmentos de path. `:id` no padrão de rota captura o literal
//   `group%2Fproject`; precisa `decodeURIComponent` na leitura.
// - `ProtectedBranches.protect` manda TUDO como query string (inclusive
//   o nome da branch, em `name=`), nunca como corpo JSON — diferente de
//   praticamente todo o resto da API.
function fullNameFromParams(params: {
  id?: string | readonly string[];
}): string {
  return decodeURIComponent(String(params.id));
}

function projectJson(repo: {
  fullName: string;
  name: string;
  visibility: 'public' | 'private';
  defaultBranch: string;
}) {
  return {
    id: 1,
    path_with_namespace: repo.fullName,
    name: repo.name,
    http_url_to_repo: `https://gitlab.com/${repo.fullName}.git`,
    default_branch: repo.defaultBranch,
    visibility: repo.visibility,
  };
}

function notFound() {
  return HttpResponse.json({ message: '404 Not found' }, { status: 404 });
}

const DEFAULT_NAMESPACE = 'acme';

export function createGitlabHandlers(store: FakeRepoStore) {
  return [
    http.get(`${BASE}/namespaces/:id`, ({ params }) => {
      return HttpResponse.json({ id: 1, full_path: String(params.id) });
    }),

    http.post(`${BASE}/projects`, async ({ request }) => {
      const body = (await request.json()) as {
        name: string;
        visibility?: 'public' | 'private';
      };
      const fullName = `${DEFAULT_NAMESPACE}/${body.name}`;
      if (store.repos.has(fullName)) {
        return HttpResponse.json(
          { message: { name: ['has already been taken'] } },
          { status: 400 },
        );
      }
      const repo = store.createRepo(
        fullName,
        body.name,
        body.visibility ?? 'private',
      );
      return HttpResponse.json(projectJson(repo), { status: 201 });
    }),

    http.get(`${BASE}/projects/:id`, ({ params }) => {
      const repo = store.repos.get(fullNameFromParams(params));
      if (!repo) return notFound();
      return HttpResponse.json(projectJson(repo));
    }),

    http.get(`${BASE}/projects/:id/repository/branches`, ({ params }) => {
      const repo = store.repos.get(fullNameFromParams(params));
      if (!repo) return notFound();
      return HttpResponse.json(
        Array.from(repo.branches.values()).map((branch) => ({
          name: branch.name,
          commit: { id: branch.sha },
          protected: branch.protected,
        })),
      );
    }),

    http.post(
      `${BASE}/projects/:id/repository/branches`,
      async ({ params, request }) => {
        const repo = store.repos.get(fullNameFromParams(params));
        if (!repo) return notFound();
        const body = (await request.json()) as { branch: string; ref: string };
        const source = repo.branches.get(body.ref);
        if (!source) return notFound();
        if (repo.branches.has(body.branch)) {
          return HttpResponse.json(
            { message: 'Branch already exists' },
            { status: 400 },
          );
        }
        const branch = { name: body.branch, sha: source.sha, protected: false };
        repo.branches.set(body.branch, branch);
        return HttpResponse.json(
          { name: branch.name, commit: { id: branch.sha }, protected: false },
          { status: 201 },
        );
      },
    ),

    http.get(`${BASE}/projects/:id/repository/tree`, ({ params }) => {
      const repo = store.repos.get(fullNameFromParams(params));
      if (!repo) return notFound();
      return HttpResponse.json([]);
    }),

    http.post(
      `${BASE}/projects/:id/repository/commits`,
      async ({ params, request }) => {
        const repo = store.repos.get(fullNameFromParams(params));
        if (!repo) return notFound();
        const body = (await request.json()) as { branch: string };
        const sha = store.nextSha();
        const existing = repo.branches.get(body.branch);
        repo.branches.set(body.branch, {
          name: body.branch,
          sha,
          protected: existing?.protected ?? false,
        });
        return HttpResponse.json({ id: sha }, { status: 201 });
      },
    ),

    http.post(
      `${BASE}/projects/:id/protected_branches`,
      ({ params, request }) => {
        const repo = store.repos.get(fullNameFromParams(params));
        if (!repo) return notFound();
        const branchName = new URL(request.url).searchParams.get('name');
        const branch = branchName ? repo.branches.get(branchName) : undefined;
        if (!branch) return notFound();
        branch.protected = true;
        return HttpResponse.json({ name: branch.name }, { status: 201 });
      },
    ),

    http.post(
      `${BASE}/projects/:id/merge_requests`,
      async ({ params, request }) => {
        const repo = store.repos.get(fullNameFromParams(params));
        if (!repo) return notFound();
        const body = (await request.json()) as {
          source_branch: string;
          target_branch: string;
          title: string;
        };
        const iid = repo.prs.length + 1;
        repo.prs.push({
          number: iid,
          sourceBranch: body.source_branch,
          targetBranch: body.target_branch,
          title: body.title,
          state: 'open',
        });
        return HttpResponse.json(
          {
            id: iid,
            iid,
            web_url: `https://gitlab.com/${repo.fullName}/-/merge_requests/${iid}`,
            source_branch: body.source_branch,
            target_branch: body.target_branch,
          },
          { status: 201 },
        );
      },
    ),

    http.put(`${BASE}/projects/:id/merge_requests/:iid/merge`, ({ params }) => {
      const repo = store.repos.get(fullNameFromParams(params));
      if (!repo) return notFound();
      const pr = repo.prs.find(
        (candidate) => candidate.number === Number(params.iid),
      );
      if (!pr) return notFound();
      pr.state = 'merged';
      return HttpResponse.json({
        id: pr.number,
        iid: pr.number,
        web_url: `https://gitlab.com/${repo.fullName}/-/merge_requests/${pr.number}`,
        source_branch: pr.sourceBranch,
        target_branch: pr.targetBranch,
      });
    }),

    http.get(`${BASE}/user`, () => {
      return HttpResponse.json({ id: 1, username: 'octocat-gl' });
    }),
  ];
}
