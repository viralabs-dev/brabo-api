import { describe } from 'vitest';
import { Gitlab } from '@gitbeaker/rest';
import type { GitProviderContract } from '@brabo/shared';
import { GitlabProvider } from '../../../src/infrastructure/git/gitlab-provider';
import { runGitProviderContract } from '../../contract/git-provider.contract';
import { withAccessToken } from './support/with-access-token';

// Smoke test MANUAL, opcional, contra a API real do GitLab — mesmo padrão
// do github-provider.smoke.spec.ts (ver lá o porquê de reusar a suite de
// contrato em vez de escrever cenários próprios). Sem GITLAB_TEST_TOKEN, o
// describe inteiro é pulado com aviso claro; nunca roda em CI por padrão.
// PAT precisa do escopo `api` (criar/ler/escrever/apagar projeto) — sem
// permissão de apagar, o cleanup falha silenciosamente (só loga aviso) e
// os projetos de teste vazam na conta/namespace usado (mesmos nomes fixos
// do harness mockado — ver comentário equivalente no smoke do GitHub).
const token = process.env.GITLAB_TEST_TOKEN;

if (!token) {
  console.warn(
    '[smoke] GITLAB_TEST_TOKEN não definido — suite de smoke do ' +
      'GitlabProvider contra a API real foi PULADA. Defina ' +
      'GITLAB_TEST_TOKEN (Personal Access Token com escopo `api`, usado ' +
      'só pra criar/apagar projetos descartáveis) pra habilitar esta ' +
      'suite manualmente.',
  );
}

describe.skipIf(!token)(
  'GitlabProvider — smoke test (API real, manual)',
  () => {
    runGitProviderContract('gitlab (API real)', () => {
      const createdProjects: string[] = [];
      const base = withAccessToken(new GitlabProvider(), token!);
      const api = new Gitlab({ token: token! });

      const provider: GitProviderContract = {
        ...base,
        createRepo: async (input) => {
          const repo = await base.createRepo(input);
          createdProjects.push(repo.externalId);
          return repo;
        },
      };

      return Promise.resolve({
        provider,
        cleanup: async () => {
          for (const fullName of createdProjects.splice(0)) {
            try {
              await api.Projects.remove(fullName);
            } catch (error) {
              console.warn(
                `[smoke] falha ao apagar ${fullName} no cleanup — verifique ` +
                  'o escopo `api` do token e apague manualmente:',
                error,
              );
            }
          }
        },
      });
    });
  },
);
