import { describe, it, expect } from 'vitest';
import { planBootstrap } from '../../../../src/application/use-cases/git/bootstrap-plan';
import {
  BRANCHING_POLICY_PATH,
  GITIGNORE_PATH,
  gitignoreContent,
  PR_TEMPLATE_PATH,
} from '../../../../src/application/use-cases/git/bootstrap-templates';
import {
  ReadOnlyGitProvider,
  type RepoEstadoFalso,
} from '../../../support/git/read-only-git-provider';

function planejar(estado: RepoEstadoFalso) {
  const provider = new ReadOnlyGitProvider(estado);
  return {
    provider,
    plano: planBootstrap({
      provider,
      externalId: 'acme/checkout',
      defaultBranch: 'main',
      accessToken: 'token',
    }),
  };
}

const semNada: RepoEstadoFalso = { branches: [{ name: 'main' }] };

describe('planBootstrap — o dry-run da adoção', () => {
  it('lista o que FARIA sem executar mutação nenhuma', async () => {
    // O provider lança em createBranch/protectBranch/commitFiles: se o
    // plano tocasse `run()` em vez de só `check()`, isto explodiria
    // dizendo qual método foi chamado.
    const { plano } = planejar(semNada);
    const resultado = await plano;

    const tipos = resultado.steps.map((s) => s.actionType);
    expect(tipos).toContain('git_commit');
    expect(tipos).not.toContain('git_branch_create');
    expect(tipos).toContain('git_branch_protect');
    expect(resultado.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('repo vazio (RN-1022, trunk): planeja os 3 arquivos, nenhuma branch e a proteção só da main', async () => {
    const { plano } = planejar(semNada);
    const { steps } = await plano;

    expect(steps.filter((s) => s.actionType === 'git_commit')).toHaveLength(3);
    // Sem `dev`/`qa`: o repositório do projeto é trunk (RN-1022).
    expect(steps.filter((s) => s.actionType === 'git_branch_create')).toEqual(
      [],
    );
    expect(
      steps
        .filter((s) => s.actionType === 'git_branch_protect')
        .map((s) => s.payload.branchName),
    ).toEqual(['main']);
  });

  it('branch JÁ protegida não entra no plano — é o que a RN-045 protege', async () => {
    const { plano } = planejar({
      branches: [{ name: 'main', protected: true }, { name: 'qa' }],
    });
    const { steps, diagnostics } = await plano;

    expect(steps.filter((s) => s.actionType === 'git_branch_protect')).toEqual(
      [],
    );
    // `qa` é de um projeto antigo: política própria, só informativa.
    expect(diagnostics.filter((d) => d.kind === 'unprotected_branch')).toEqual(
      [],
    );
  });

  it('main desprotegida entra no plano e vira diagnóstico', async () => {
    const { plano } = planejar({ branches: [{ name: 'main' }] });
    const { steps, diagnostics } = await plano;

    expect(
      steps
        .filter((s) => s.actionType === 'git_branch_protect')
        .map((s) => s.payload.branchName),
    ).toEqual(['main']);
    expect(diagnostics.filter((d) => d.kind === 'unprotected_branch')).toEqual([
      { kind: 'unprotected_branch', detail: { branchName: 'main' } },
    ]);
  });

  it('`rc` de um repo antigo vira branch EXTRA, não passo do plano', async () => {
    // Consequência deliberada de tirar `rc` do template (achado #3): um
    // repositório bootstrapado por uma versão anterior do Brabo tem `rc`, e
    // ela passa a ser o que de fato é hoje — política do projeto, descrita no
    // plano e nunca tocada. O contrário (continuar protegendo uma branch que
    // a política abandonou) é que seria mentira.
    const { plano } = planejar({
      branches: [
        { name: 'main', protected: true },
        { name: 'rc', protected: true },
      ],
      arquivosCanonicos: [
        PR_TEMPLATE_PATH,
        BRANCHING_POLICY_PATH,
        GITIGNORE_PATH,
      ],
    });
    const { steps, diagnostics } = await plano;

    expect(steps).toEqual([]);
    expect(
      diagnostics
        .filter((d) => d.kind === 'extra_branch')
        .map((d) => d.detail.branchName),
    ).toEqual(['rc']);
  });

  it('branch fora do template vira diagnóstico informativo, nunca passo', async () => {
    const { plano } = planejar({
      branches: [
        { name: 'main', protected: true },
        { name: 'dev', protected: true },
        { name: 'develop' },
        { name: 'release/1.2' },
      ],
    });
    const { steps, diagnostics } = await plano;

    const extras = diagnostics.filter((d) => d.kind === 'extra_branch');
    expect(extras.map((d) => d.detail.branchName)).toEqual([
      'dev',
      'develop',
      'release/1.2',
    ]);
    // Informativo: nenhum passo do plano menciona essas branches.
    const tocadas = steps.map((s) => s.payload.branchName);
    expect(tocadas).not.toContain('develop');
    expect(tocadas).not.toContain('release/1.2');
  });

  it('arquivo já idêntico ao template não entra no plano', async () => {
    const { plano } = planejar({
      branches: [{ name: 'main' }],
      arquivosCanonicos: [PR_TEMPLATE_PATH],
    });
    const { steps } = await plano;

    const caminhos = steps
      .filter((s) => s.actionType === 'git_commit')
      .map((s) => s.payload.path);
    expect(caminhos).toEqual([BRANCHING_POLICY_PATH, GITIGNORE_PATH]);
  });

  // RN-761 (AT-446): o `.gitignore` base só entra quando o repositório não
  // tem um — o do usuário, diferente do template, nunca é sobrescrito.
  it('RN-948: o `.gitignore` base traz os seis padrões de arquivo de dados', () => {
    const linhas = gitignoreContent().split('\n');
    for (const p of [
      '*.db',
      '*.db-*',
      '*.sqlite',
      '*.sqlite-*',
      '*.sqlite3',
      '*.sqlite3-*',
    ]) {
      expect(linhas).toContain(p);
    }
  });

  it('`.gitignore` do usuário não entra no plano', async () => {
    const { plano } = planejar({
      branches: [{ name: 'main' }],
      arquivosCanonicos: [PR_TEMPLATE_PATH, BRANCHING_POLICY_PATH],
      arquivosDoUsuario: { [GITIGNORE_PATH]: 'dist/\n' },
    });
    const { steps } = await plano;

    expect(
      steps
        .filter((s) => s.actionType === 'git_commit')
        .map((s) => s.payload.path),
    ).toEqual([]);
  });

  it('provider sem capability de proteção degrada com diagnóstico, não com erro', async () => {
    const { plano } = planejar({
      branches: [{ name: 'main' }],
      capabilities: { protectBranch: false },
    });
    const { steps, diagnostics } = await plano;

    expect(steps.filter((s) => s.actionType === 'git_branch_protect')).toEqual(
      [],
    );
    expect(
      diagnostics.find((d) => d.kind === 'capability_unsupported'),
    ).toEqual({
      kind: 'capability_unsupported',
      detail: { step: 'protect_branches', provider: 'github' },
    });
  });

  it('repo já convergido: plano vazio de passos, e nada a decidir', async () => {
    const { plano } = planejar({
      branches: [{ name: 'main', protected: true }],
      arquivosCanonicos: [
        PR_TEMPLATE_PATH,
        BRANCHING_POLICY_PATH,
        GITIGNORE_PATH,
      ],
    });
    const { steps, diagnostics } = await plano;

    expect(steps).toEqual([]);
    expect(diagnostics).toEqual([]);
  });
});
