import { http, HttpResponse } from 'msw';
import type { FakeRepoStore } from './fake-repo-store';

const BASE = 'https://api.github.com';

function fullNameFromParams(params: {
  owner?: string | readonly string[];
  repo?: string | readonly string[];
}): string {
  return `${String(params.owner)}/${String(params.repo)}`;
}

function repoJson(repo: {
  fullName: string;
  name: string;
  visibility: 'public' | 'private';
  defaultBranch: string;
}) {
  return {
    full_name: repo.fullName,
    name: repo.name,
    clone_url: `https://github.com/${repo.fullName}.git`,
    html_url: `https://github.com/${repo.fullName}`,
    default_branch: repo.defaultBranch,
    private: repo.visibility === 'private',
  };
}

function notFound() {
  return HttpResponse.json({ message: 'Not Found' }, { status: 404 });
}

export function createGithubHandlers(store: FakeRepoStore) {
  return [
    http.post(`${BASE}/user/repos`, async ({ request }) => {
      const body = (await request.json()) as {
        name: string;
        private?: boolean;
      };
      return handleCreateRepo(
        store,
        'octocat',
        body.name,
        body.private ? 'private' : 'public',
      );
    }),

    http.post(`${BASE}/orgs/:org/repos`, async ({ params, request }) => {
      const body = (await request.json()) as {
        name: string;
        private?: boolean;
      };
      return handleCreateRepo(
        store,
        String(params.org),
        body.name,
        body.private ? 'private' : 'public',
      );
    }),

    http.get(`${BASE}/repos/:owner/:repo`, ({ params }) => {
      const repo = store.repos.get(fullNameFromParams(params));
      if (!repo) return notFound();
      return HttpResponse.json(repoJson(repo));
    }),

    http.get(`${BASE}/repos/:owner/:repo/git/ref/*`, ({ params, request }) => {
      const repo = store.repos.get(fullNameFromParams(params));
      if (!repo) return notFound();
      const branchName = refSuffix(request.url, '/git/ref/').replace(
        /^heads\//,
        '',
      );
      const branch = repo.branches.get(branchName);
      if (!branch) return notFound();
      return HttpResponse.json({
        ref: `refs/heads/${branchName}`,
        object: { sha: branch.sha, type: 'commit' },
      });
    }),

    http.get(`${BASE}/repos/:owner/:repo/git/matching-refs/*`, ({ params }) => {
      const repo = store.repos.get(fullNameFromParams(params));
      if (!repo) return notFound();
      const items = Array.from(repo.branches.values()).map((branch) => ({
        ref: `refs/heads/${branch.name}`,
        object: { sha: branch.sha, type: 'commit' },
      }));
      return HttpResponse.json(items);
    }),

    http.get(`${BASE}/repos/:owner/:repo/git/commits/:sha`, ({ params }) => {
      const sha = String(params.sha);
      return HttpResponse.json({ sha, tree: { sha: `tree-${sha}` } });
    }),

    http.post(`${BASE}/repos/:owner/:repo/git/blobs`, () => {
      return HttpResponse.json({ sha: store.nextSha() }, { status: 201 });
    }),

    http.post(`${BASE}/repos/:owner/:repo/git/trees`, () => {
      return HttpResponse.json({ sha: store.nextSha() }, { status: 201 });
    }),

    http.post(`${BASE}/repos/:owner/:repo/git/commits`, () => {
      return HttpResponse.json({ sha: store.nextSha() }, { status: 201 });
    }),

    http.post(
      `${BASE}/repos/:owner/:repo/git/refs`,
      async ({ params, request }) => {
        const repo = store.repos.get(fullNameFromParams(params));
        if (!repo) return notFound();
        const body = (await request.json()) as { ref: string; sha: string };
        const branchName = body.ref.replace(/^refs\/heads\//, '');
        if (repo.branches.has(branchName)) {
          return HttpResponse.json(
            { message: 'Reference already exists' },
            { status: 422 },
          );
        }
        repo.branches.set(branchName, {
          name: branchName,
          sha: body.sha,
          protected: false,
        });
        return HttpResponse.json(
          { ref: body.ref, object: { sha: body.sha, type: 'commit' } },
          { status: 201 },
        );
      },
    ),

    http.patch(
      `${BASE}/repos/:owner/:repo/git/refs/*`,
      async ({ params, request }) => {
        const repo = store.repos.get(fullNameFromParams(params));
        if (!repo) return notFound();
        const branchName = refSuffix(request.url, '/git/refs/').replace(
          /^heads\//,
          '',
        );
        const branch = repo.branches.get(branchName);
        if (!branch) return notFound();
        const body = (await request.json()) as { sha: string };
        branch.sha = body.sha;
        return HttpResponse.json({
          ref: `refs/heads/${branchName}`,
          object: { sha: body.sha, type: 'commit' },
        });
      },
    ),

    http.get(`${BASE}/repos/:owner/:repo/branches`, ({ params }) => {
      const repo = store.repos.get(fullNameFromParams(params));
      if (!repo) return notFound();
      return HttpResponse.json(
        Array.from(repo.branches.values()).map((branch) => ({
          name: branch.name,
          commit: { sha: branch.sha },
          protected: branch.protected,
        })),
      );
    }),

    http.put(
      `${BASE}/repos/:owner/:repo/branches/:branch/protection`,
      ({ params }) => {
        const repo = store.repos.get(fullNameFromParams(params));
        if (!repo) return notFound();
        const branch = repo.branches.get(String(params.branch));
        if (!branch)
          return HttpResponse.json(
            { message: 'Branch not protected' },
            { status: 404 },
          );
        branch.protected = true;
        return HttpResponse.json({ enabled: true });
      },
    ),

    http.post(
      `${BASE}/repos/:owner/:repo/pulls`,
      async ({ params, request }) => {
        const repo = store.repos.get(fullNameFromParams(params));
        if (!repo) return notFound();
        const body = (await request.json()) as {
          title: string;
          head: string;
          base: string;
        };
        const number = repo.prs.length + 1;
        repo.prs.push({
          number,
          sourceBranch: body.head,
          targetBranch: body.base,
          title: body.title,
          state: 'open',
        });
        return HttpResponse.json(
          {
            id: number,
            number,
            html_url: `https://github.com/${repo.fullName}/pull/${number}`,
            head: { ref: body.head },
            base: { ref: body.base },
          },
          { status: 201 },
        );
      },
    ),

    http.put(`${BASE}/repos/:owner/:repo/pulls/:number/merge`, ({ params }) => {
      const repo = store.repos.get(fullNameFromParams(params));
      if (!repo) return notFound();
      const pr = repo.prs.find(
        (candidate) => candidate.number === Number(params.number),
      );
      if (!pr) return notFound();
      pr.state = 'merged';
      return HttpResponse.json({ merged: true, sha: store.nextSha() });
    }),

    http.get(`${BASE}/repos/:owner/:repo/pulls/:number`, ({ params }) => {
      const repo = store.repos.get(fullNameFromParams(params));
      if (!repo) return notFound();
      const pr = repo.prs.find(
        (candidate) => candidate.number === Number(params.number),
      );
      if (!pr) return notFound();
      return HttpResponse.json({
        id: pr.number,
        number: pr.number,
        html_url: `https://github.com/${repo.fullName}/pull/${pr.number}`,
        head: { ref: pr.sourceBranch },
        base: { ref: pr.targetBranch },
      });
    }),
  ];
}

function handleCreateRepo(
  store: FakeRepoStore,
  owner: string,
  name: string,
  visibility: 'public' | 'private',
) {
  const fullName = `${owner}/${name}`;
  if (store.repos.has(fullName)) {
    return HttpResponse.json(
      {
        message: 'Repository creation failed.',
        errors: [
          {
            resource: 'Repository',
            code: 'custom',
            field: 'name',
            message: 'name already exists on this account',
          },
        ],
      },
      { status: 422 },
    );
  }
  const repo = store.createRepo(fullName, name, visibility);
  return HttpResponse.json(repoJson(repo), { status: 201 });
}

function refSuffix(url: string, marker: string): string {
  const pathname = new URL(url).pathname;
  const idx = pathname.indexOf(marker);
  return decodeURIComponent(pathname.slice(idx + marker.length));
}
