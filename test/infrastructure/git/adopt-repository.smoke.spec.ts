import { describe, expect, it } from 'vitest';
import { GithubProvider } from '../../../src/infrastructure/git/github-provider';
import { planBootstrap } from '../../../src/application/use-cases/git/bootstrap-plan';

/**
 * Smoke test MANUAL, opcional, contra um repositório REAL do GitHub — o
 * aceite da Fase 12a: "adotar o fork da Fase 10 sem nenhum seed manual,
 * com o plano mostrando a divergência real dele".
 *
 * SOMENTE LEITURA. Roda `getRepo` + `planBootstrap`, que só chamam
 * `listBranches`/`getFileContent`, e imprime o plano. **Nunca aprova**:
 * aprovar mutaria um repositório de verdade, e um teste não é lugar de
 * decidir isso — a decisão é o portão humano da RN-045.
 *
 * Nunca roda em CI: sem `ADOPT_TEST_REPO` + `GITHUB_TEST_TOKEN`, o
 * describe inteiro é pulado com aviso, mesmo molde de
 * `github-provider.smoke.spec.ts`.
 *
 *   ADOPT_TEST_REPO=meu-usuario/brabo \
 *   GITHUB_TEST_TOKEN=ghp_... \
 *   pnpm --filter api exec vitest run test/infrastructure/git/adopt-repository.smoke.spec.ts
 */
const token = process.env.GITHUB_TEST_TOKEN;
const externalId = process.env.ADOPT_TEST_REPO;
const habilitado = Boolean(token && externalId);

if (!habilitado) {
  console.warn(
    '[smoke] ADOPT_TEST_REPO e/ou GITHUB_TEST_TOKEN não definidos — o aceite ' +
      'da adoção contra repositório real foi PULADO. Defina ADOPT_TEST_REPO ' +
      '(no formato `dono/repo`, ex.: o fork da Fase 10) e GITHUB_TEST_TOKEN ' +
      '(PAT com leitura nele) para habilitar. A suite é SOMENTE LEITURA: lê o ' +
      'repositório e imprime o plano, nunca aprova nem altera nada.',
  );
}

describe.skipIf(!habilitado)(
  'Adoção — aceite contra repositório real (Fase 12a, manual)',
  () => {
    const provider = new GithubProvider();

    it('lê o repositório e produz um plano com a divergência real dele', async () => {
      const repo = await provider.getRepo({
        externalId: externalId!,
        accessToken: token,
      });
      expect(repo.externalId).toBeTruthy();

      const plan = await planBootstrap({
        provider,
        externalId: repo.externalId,
        defaultBranch: repo.defaultBranch,
        accessToken: token,
      });

      // O plano é bem-formado e serializável — é o que vai pro jsonb.
      expect(plan.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(Array.isArray(plan.steps)).toBe(true);
      expect(Array.isArray(plan.diagnostics)).toBe(true);
      expect(() => JSON.stringify(plan)).not.toThrow();

      // Nenhum passo pode citar branch que não seja do template — o
      // bootstrap não toca o que é do repositório.
      for (const passo of plan.steps) {
        const branch = passo.payload.branchName;
        if (typeof branch === 'string') {
          expect(['main', 'dev', 'qa', 'rc']).toContain(branch);
        }
      }

      console.log(
        `\n[smoke] plano para ${repo.externalId} (default: ${repo.defaultBranch})`,
      );
      console.log(
        `  passos (${plan.steps.length}):`,
        plan.steps.map((s) => `${s.actionType} ${JSON.stringify(s.payload)}`),
      );
      console.log(
        `  divergências (${plan.diagnostics.length}):`,
        plan.diagnostics.map((d) => `${d.kind} ${JSON.stringify(d.detail)}`),
      );
      console.log(
        '  NADA foi alterado — aprovar o plano é decisão humana, fora deste teste.\n',
      );
    });
  },
);
