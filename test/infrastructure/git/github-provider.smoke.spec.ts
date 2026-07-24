import { describe } from 'vitest';
import { Octokit } from '@octokit/rest';
import type { GitProviderContract } from '@brabo/shared';
import { GithubProvider } from '../../../src/infrastructure/git/github-provider';
import { runGitProviderContract } from '../../contract/git-provider.contract';
import { withAccessToken } from './support/with-access-token';

// Smoke test MANUAL, opcional, contra a API real do GitHub — nunca roda em
// CI por padrão (sem GITHUB_TEST_TOKEN, o describe inteiro é pulado com um
// aviso claro no console). Reusa a MESMA suite de contrato rodada contra o
// mock (ver github-provider.contract.spec.ts) — a diferença é só o
// harness: aqui `withAccessToken` recebe o token real em vez de
// 'fake-token', e cada repositório criado durante um teste é apagado no
// `cleanup()` daquele teste (rastreado via wrapper em `createRepo`), pra
// deixar sempre descartável e seguro rodar de novo. O PAT usado precisa
// dos escopos `repo` (criar/ler/escrever) E `delete_repo` (senão o
// cleanup falha silenciosamente e os repositórios de teste vazam na
// conta) — sem `delete_repo`, rode manualmente e apague os repositórios
// criados (nomes fixos: "contrato repo", "duplicado", "consulta",
// "commit-happy", "commit-second", "commit-missing-branch",
// "branch-happy", "branch-missing-ref", "branch-duplicada",
// "list-branches", "protect", "pr-open", "pr-merge") antes de rodar de
// novo, senão "createRepo: cria um repositório novo" e os testes de
// "já existe" colidem com o que sobrou da execução anterior.
const token = process.env.GITHUB_TEST_TOKEN;

if (!token) {
  console.warn(
    '[smoke] GITHUB_TEST_TOKEN não definido — suite de smoke do ' +
      'GithubProvider contra a API real foi PULADA. Defina ' +
      'GITHUB_TEST_TOKEN (Personal Access Token com escopos `repo` e ' +
      '`delete_repo`, usado só pra criar/apagar repositórios ' +
      'descartáveis) pra habilitar esta suite manualmente.',
  );
}

describe.skipIf(!token)(
  'GithubProvider — smoke test (API real, manual)',
  () => {
    runGitProviderContract('github (API real)', () => {
      const createdRepos: string[] = [];
      const base = withAccessToken(new GithubProvider(), token!);
      const octokit = new Octokit({ auth: token });

      const provider: GitProviderContract = {
        ...base,
        createRepo: async (input) => {
          const repo = await base.createRepo(input);
          createdRepos.push(repo.externalId);
          return repo;
        },
      };

      return Promise.resolve({
        provider,
        cleanup: async () => {
          for (const fullName of createdRepos.splice(0)) {
            const [owner, repo] = fullName.split('/');
            try {
              await octokit.rest.repos.delete({ owner, repo });
            } catch (error) {
              console.warn(
                `[smoke] falha ao apagar ${fullName} no cleanup — verifique ` +
                  'o escopo `delete_repo` do token e apague manualmente:',
                error,
              );
            }
          }
        },
      });
    });
  },
);
