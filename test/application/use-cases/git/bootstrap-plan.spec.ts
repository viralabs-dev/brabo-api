import { describe, it, expect } from 'vitest';
import { planBootstrap } from '../../../../src/application/use-cases/git/bootstrap-plan';
import {
  BRANCHING_POLICY_PATH,
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
    expect(tipos).toContain('git_branch_create');
    expect(tipos).toContain('git_branch_protect');
    expect(resultado.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('repo vazio: planeja os 2 arquivos, as 2 branches e as 3 proteções', async () => {
    const { plano } = planejar(semNada);
    const { steps } = await plano;

    expect(steps.filter((s) => s.actionType === 'git_commit')).toHaveLength(2);
    expect(
      steps
        .filter((s) => s.actionType === 'git_branch_create')
        .map((s) => s.payload.branchName),
    ).toEqual(['dev', 'qa']);
    // main já existe e as duas nascem no plano — as 3 entram pra proteger.
    // `rc` saiu com o degrau (ADR 0030, achado #3): o bootstrap não a cria
    // nem a protege mais.
    expect(
      steps
        .filter((s) => s.actionType === 'git_branch_protect')
        .map((s) => s.payload.branchName),
    ).toEqual(['main', 'qa', 'dev']);
  });

  it('branch JÁ protegida não entra no plano — é o que a RN-045 protege', async () => {
    const { plano } = planejar({
      branches: [
        { name: 'main', protected: true },
        { name: 'dev', protected: true },
        { name: 'qa', protected: false },
      ],
    });
    const { steps, diagnostics } = await plano;

    const aProteger = steps
      .filter((s) => s.actionType === 'git_branch_protect')
      .map((s) => s.payload.branchName);
    expect(aProteger).toEqual(['qa']);

    expect(diagnostics.filter((d) => d.kind === 'unprotected_branch')).toEqual([
      { kind: 'unprotected_branch', detail: { branchName: 'qa' } },
    ]);
  });

  it('promete a proteção das branches que ELE MESMO vai criar', async () => {
    // Tem main/dev protegidas, falta `qa`. `check()` sozinho não veria `qa`
    // como desprotegida — ela nem existe ainda —, então o plano diria "crio
    // qa" sem avisar que ela sairia protegida. Prometer MENOS do que a
    // execução faz é exatamente o que a RN-045 não pode permitir.
    const { plano } = planejar({
      branches: [
        { name: 'main', protected: true },
        { name: 'dev', protected: true },
      ],
    });
    const { steps } = await plano;

    expect(
      steps
        .filter((s) => s.actionType === 'git_branch_create')
        .map((s) => s.payload.branchName),
    ).toEqual(['qa']);
    expect(
      steps
        .filter((s) => s.actionType === 'git_branch_protect')
        .map((s) => s.payload.branchName),
    ).toEqual(['qa']);
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
        { name: 'dev', protected: true },
        { name: 'qa', protected: true },
        { name: 'rc', protected: true },
      ],
      arquivosCanonicos: [PR_TEMPLATE_PATH, BRANCHING_POLICY_PATH],
    });
    const { steps, diagnostics } = await plano;

    expect(steps).toEqual([]);
    expect(
      diagnostics.filter((d) => d.kind === 'extra_branch').map((d) => d.detail.branchName),
    ).toEqual(['rc']);
  });

  it('branch fora do template vira diagnóstico informativo, nunca passo', async () => {
    const { plano } = planejar({
      branches: [
        { name: 'main', protected: true },
        { name: 'dev', protected: true },
        { name: 'qa', protected: true },
        { name: 'develop' },
        { name: 'release/1.2' },
      ],
    });
    const { steps, diagnostics } = await plano;

    const extras = diagnostics.filter((d) => d.kind === 'extra_branch');
    expect(extras.map((d) => d.detail.branchName)).toEqual([
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
    expect(caminhos).toEqual([BRANCHING_POLICY_PATH]);
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
      branches: [
        { name: 'main', protected: true },
        { name: 'dev', protected: true },
        { name: 'qa', protected: true },
      ],
      arquivosCanonicos: [PR_TEMPLATE_PATH, BRANCHING_POLICY_PATH],
    });
    const { steps, diagnostics } = await plano;

    expect(steps).toEqual([]);
    expect(diagnostics).toEqual([]);
  });
});
