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
      // Repo SEM commit nenhum: a API de refs inteira responde 409, não 404.
      // O fake respondia 404 e por isso a suite passava enquanto o GitHub de
      // verdade derrubava o bootstrap no primeiro passo.
      if (repo.branches.size === 0) return repositorioVazio();
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
      // Mesmo 409 do `git/ref`: num repo vazio NÃO existe lista vazia, existe
      // erro. Devolver `[]` aqui era o que fazia o provider achar que tinha
      // como perguntar "quantas branches há?" antes do primeiro commit.
      if (repo.branches.size === 0) return repositorioVazio();
      const items = Array.from(repo.branches.values()).map((branch) => ({
        ref: `refs/heads/${branch.name}`,
        object: { sha: branch.sha, type: 'commit' },
      }));
      return HttpResponse.json(items);
    }),

    http.get(`${BASE}/repos/:owner/:repo/git/commits/:sha`, ({ params }) => {
      const sha = String(params.sha);
      const treeSha = store.commitTree.get(sha) ?? `tree-${sha}`;
      return HttpResponse.json({ sha, tree: { sha: treeSha } });
    }),

    http.post(
      `${BASE}/repos/:owner/:repo/git/blobs`,
      async ({ params, request }) => {
      const repoDoBlob = store.repos.get(fullNameFromParams(params));
      // A Git Data API INTEIRA responde 409 num repo sem commit — não só as
      // refs. Sem isto, o fake deixaria montar blob/tree/commit num repo vazio
      // e o teste não conseguiria reproduzir o bootstrap morrendo.
      if (repoDoBlob && repoDoBlob.branches.size === 0) return repositorioVazio();
      const body = (await request.json()) as {
        content: string;
        encoding?: string;
      };
      const sha = store.nextSha();
      const decoded =
        body.encoding === 'base64'
          ? Buffer.from(body.content, 'base64').toString('utf8')
          : body.content;
      store.blobContent.set(sha, decoded);
      return HttpResponse.json({ sha }, { status: 201 });
      },
    ),

    /**
     * Contents API — o ÚNICO caminho que cria o primeiro commit num repo
     * vazio. Cria o arquivo, o commit e a branch de uma vez.
     */
    http.put(
      `${BASE}/repos/:owner/:repo/contents/*`,
      async ({ params, request }) => {
        const repo = store.repos.get(fullNameFromParams(params));
        if (!repo) return notFound();

        const body = (await request.json()) as {
          content: string;
          branch?: string;
          message: string;
        };
        const path = refSuffix(request.url, '/contents/');
        const branchName = body.branch ?? repo.defaultBranch;
        const sha = store.nextSha();
        const treeSha = store.nextSha();

        const anterior = repo.branches.get(branchName);
        const arquivos = new Map(
          anterior ? store.treeFiles.get(store.commitTree.get(anterior.sha) ?? '') ?? [] : [],
        );
        arquivos.set(path, Buffer.from(body.content, 'base64').toString('utf8'));

        store.treeFiles.set(treeSha, arquivos);
        store.commitTree.set(sha, treeSha);
        repo.branches.set(branchName, {
          name: branchName,
          sha,
          protected: anterior?.protected ?? false,
        });

        return HttpResponse.json(
          { content: { path }, commit: { sha } },
          { status: 201 },
        );
      },
    ),

    http.post(`${BASE}/repos/:owner/:repo/git/trees`, async ({ request }) => {
      const body = (await request.json()) as {
        base_tree?: string;
        tree: { path: string; sha: string }[];
      };
      const sha = store.nextSha();
      const files = new Map(store.treeFiles.get(body.base_tree ?? '') ?? []);
      for (const entry of body.tree) {
        const content = store.blobContent.get(entry.sha);
        if (content !== undefined) files.set(entry.path, content);
      }
      store.treeFiles.set(sha, files);
      return HttpResponse.json({ sha }, { status: 201 });
    }),

    http.post(`${BASE}/repos/:owner/:repo/git/commits`, async ({ request }) => {
      const body = (await request.json()) as { tree: string };
      const sha = store.nextSha();
      store.commitTree.set(sha, body.tree);
      return HttpResponse.json({ sha }, { status: 201 });
    }),

    http.get(`${BASE}/repos/:owner/:repo/contents/*`, ({ params, request }) => {
      const repo = store.repos.get(fullNameFromParams(params));
      if (!repo) return notFound();
      const path = refSuffix(request.url, '/contents/');
      const ref = new URL(request.url).searchParams.get('ref');
      const commitSha = (ref ? repo.branches.get(ref)?.sha : undefined) ?? ref;
      const treeSha = commitSha ? store.commitTree.get(commitSha) : undefined;
      const content = treeSha
        ? store.treeFiles.get(treeSha)?.get(path)
        : undefined;
      if (content === undefined) return notFound();
      return HttpResponse.json({
        type: 'file',
        encoding: 'base64',
        content: Buffer.from(content, 'utf8').toString('base64'),
      });
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

    http.post(
      `${BASE}/repos/:owner/:repo/issues/:number/comments`,
      async ({ params, request }) => {
        const repo = store.repos.get(fullNameFromParams(params));
        if (!repo) return notFound();
        const pr = repo.prs.find(
          (candidate) => candidate.number === Number(params.number),
        );
        if (!pr) return notFound();
        const body = (await request.json()) as { body: string };
        return HttpResponse.json({ id: 1, body: body.body }, { status: 201 });
      },
    ),
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

/**
 * `409 Git Repository is empty` — a resposta REAL do GitHub para qualquer
 * leitura de ref num repositório recém-criado com `auto_init: false`.
 * Verificado contra a API viva em 2026-08-04, em `daneiel/hello-api`.
 */
function repositorioVazio() {
  return HttpResponse.json(
    {
      message: 'Git Repository is empty.',
      documentation_url: 'https://docs.github.com/rest/git/refs#get-a-reference',
    },
    { status: 409 },
  );
}

function refSuffix(url: string, marker: string): string {
  const pathname = new URL(url).pathname;
  const idx = pathname.indexOf(marker);
  return decodeURIComponent(pathname.slice(idx + marker.length));
}
