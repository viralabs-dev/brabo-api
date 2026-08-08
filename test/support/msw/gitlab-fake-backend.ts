import { http, HttpResponse } from 'msw';
import type { FakeRepoStore } from './fake-repo-store';
import { compararArvores } from './fake-diff';

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
        const branch = {
          name: body.branch,
          sha: source.sha,
          protected: false,
          files: source.files ? new Map(source.files) : undefined,
        };
        repo.branches.set(body.branch, branch);
        return HttpResponse.json(
          { name: branch.name, commit: { id: branch.sha }, protected: false },
          { status: 201 },
        );
      },
    ),

    /**
     * A árvore do repositório. O fake DEVOLVIA sempre `[]` — bastava para o
     * `commitFiles` (que só perguntava quais caminhos já existiam, e com
     * lista vazia mandava tudo como `create`), mas deixava `listTree` sem
     * nada para exercitar. Agora responde a partir dos arquivos da branch,
     * nos dois modos que o provider usa: recursivo (commitFiles) e um nível
     * (listTree).
     */
    http.get(`${BASE}/projects/:id/repository/tree`, ({ params, request }) => {
      const repo = store.repos.get(fullNameFromParams(params));
      if (!repo) return notFound();

      const url = new URL(request.url);
      const ref = url.searchParams.get('ref') ?? repo.defaultBranch;
      const path = (url.searchParams.get('path') ?? '').replace(/\/+$/, '');
      const recursivo = url.searchParams.get('recursive') === 'true';

      const branch = repo.branches.get(ref);
      // Ref inexistente é 404 no GitLab — não lista vazia.
      if (!branch) return notFound();
      const arquivos = branch.files ?? new Map<string, string>();

      if (recursivo) {
        return HttpResponse.json(
          [...arquivos.keys()].sort().map((caminho) => ({
            id: `blob-${caminho}`,
            name: caminho.slice(caminho.lastIndexOf('/') + 1),
            type: 'blob',
            path: caminho,
            mode: '100644',
          })),
        );
      }

      const prefixo = path === '' ? '' : `${path}/`;
      const vistos = new Map<
        string,
        { id: string; name: string; type: string; path: string; mode: string }
      >();
      for (const caminho of arquivos.keys()) {
        if (prefixo !== '' && !caminho.startsWith(prefixo)) continue;
        const resto = caminho.slice(prefixo.length);
        if (resto === '') continue;
        const corte = resto.indexOf('/');
        const nome = corte === -1 ? resto : resto.slice(0, corte);
        vistos.set(nome, {
          id: `${corte === -1 ? 'blob' : 'tree'}-${prefixo}${nome}`,
          name: nome,
          type: corte === -1 ? 'blob' : 'tree',
          path: `${prefixo}${nome}`,
          mode: corte === -1 ? '100644' : '040000',
        });
      }

      // Caminho inexistente (ou que é arquivo) responde 200 com lista VAZIA
      // no GitLab, não 404 — é essa assimetria com o GitHub que o provider
      // normaliza.
      return HttpResponse.json([...vistos.values()]);
    }),

    http.get(
      `${BASE}/projects/:id/merge_requests/:iid/diffs`,
      ({ params, request }) => {
        const repo = store.repos.get(fullNameFromParams(params));
        if (!repo) return notFound();
        const pr = repo.prs.find(
          (candidate) => candidate.number === Number(params.iid),
        );
        if (!pr) return notFound();

        const url = new URL(request.url);
        const perPage = Number(url.searchParams.get('per_page') ?? '20');
        const page = Number(url.searchParams.get('page') ?? '1');

        const arquivos = compararArvores(
          repo.branches.get(pr.targetBranch)?.files ?? new Map(),
          repo.branches.get(pr.sourceBranch)?.files ?? new Map(),
        );

        return HttpResponse.json(
          arquivos
            .slice((page - 1) * perPage, page * perPage)
            .map((arquivo) => ({
              old_path: arquivo.previousPath ?? arquivo.path,
              new_path: arquivo.path,
              a_mode: '100644',
              b_mode: '100644',
              new_file: arquivo.status === 'added',
              renamed_file: arquivo.status === 'renamed',
              deleted_file: arquivo.status === 'removed',
              diff: arquivo.patch,
            })),
        );
      },
    ),

    http.post(
      `${BASE}/projects/:id/repository/commits`,
      async ({ params, request }) => {
        const repo = store.repos.get(fullNameFromParams(params));
        if (!repo) return notFound();
        const body = (await request.json()) as {
          branch: string;
          actions: { action: string; file_path: string; content?: string }[];
        };
        const sha = store.nextSha();
        const existing = repo.branches.get(body.branch);
        const files = new Map(existing?.files ?? []);
        for (const action of body.actions) {
          if (action.action === 'delete') {
            files.delete(action.file_path);
          } else if (action.content !== undefined) {
            files.set(action.file_path, action.content);
          }
        }
        repo.branches.set(body.branch, {
          name: body.branch,
          sha,
          protected: existing?.protected ?? false,
          files,
        });
        return HttpResponse.json({ id: sha }, { status: 201 });
      },
    ),

    http.get(
      `${BASE}/projects/:id/repository/files/:file_path`,
      ({ params, request }) => {
        const repo = store.repos.get(fullNameFromParams(params));
        if (!repo) return notFound();
        const path = decodeURIComponent(String(params.file_path));
        const ref = new URL(request.url).searchParams.get('ref');
        const branch = ref ? repo.branches.get(ref) : undefined;
        const content = branch?.files?.get(path);
        if (content === undefined) return notFound();
        return HttpResponse.json({
          content: Buffer.from(content, 'utf8').toString('base64'),
          encoding: 'base64',
        });
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

    http.post(
      `${BASE}/projects/:id/merge_requests/:iid/notes`,
      async ({ params, request }) => {
        const repo = store.repos.get(fullNameFromParams(params));
        if (!repo) return notFound();
        const pr = repo.prs.find(
          (candidate) => candidate.number === Number(params.iid),
        );
        if (!pr) return notFound();
        const body = (await request.json()) as { body: string };
        return HttpResponse.json({ id: 1, body: body.body }, { status: 201 });
      },
    ),

    http.get(`${BASE}/user`, () => {
      return HttpResponse.json({ id: 1, username: 'octocat-gl' });
    }),
  ];
}
