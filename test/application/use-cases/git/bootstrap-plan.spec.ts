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

  it('repo vazio: planeja os 2 arquivos, as 3 branches e as 4 proteções', async () => {
    const { plano } = planejar(semNada);
    const { steps } = await plano;

    expect(steps.filter((s) => s.actionType === 'git_commit')).toHaveLength(2);
    expect(
      steps
        .filter((s) => s.actionType === 'git_branch_create')
        .map((s) => s.payload.branchName),
    ).toEqual(['dev', 'qa', 'rc']);
    // main já existe e as três nascem no plano — as 4 entram pra proteger.
    expect(
      steps
        .filter((s) => s.actionType === 'git_branch_protect')
        .map((s) => s.payload.branchName),
    ).toEqual(['main', 'rc', 'qa', 'dev']);
  });

  it('branch JÁ protegida não entra no plano — é o que a RN-045 protege', async () => {
    const { plano } = planejar({
      branches: [
        { name: 'main', protected: true },
        { name: 'dev', protected: true },
        { name: 'qa', protected: false },
        { name: 'rc', protected: true },
      ],
    });
    const { steps, diagnostics } = await plano;

    const aProteger = steps
      .filter((s) => s.actionType === 'git_branch_protect')
      .map((s) => s.payload.branchName);
    expect(aProteger).toEqual(['qa']);

    expect(
      diagnostics.filter((d) => d.kind === 'unprotected_branch'),
    ).toEqual([{ kind: 'unprotected_branch', detail: { branchName: 'qa' } }]);
  });

  it('promete a proteção das branches que ELE MESMO vai criar', async () => {
    // O caso do fork da Fase 10: tem main/dev/qa protegidas, falta rc.
    // `check()` sozinho não veria `rc` como desprotegida — ela nem
    // existe ainda —, então o plano diria "crio rc" sem avisar que ela
    // sairia protegida. Prometer MENOS do que a execução faz é
    // exatamente o que a RN-045 não pode permitir.
    const { plano } = planejar({
      branches: [
        { name: 'main', protected: true },
        { name: 'dev', protected: true },
        { name: 'qa', protected: true },
      ],
    });
    const { steps } = await plano;

    expect(
      steps
        .filter((s) => s.actionType === 'git_branch_create')
        .map((s) => s.payload.branchName),
    ).toEqual(['rc']);
    expect(
      steps
        .filter((s) => s.actionType === 'git_branch_protect')
        .map((s) => s.payload.branchName),
    ).toEqual(['rc']);
  });

  it('branch fora do template vira diagnóstico informativo, nunca passo', async () => {
    const { plano } = planejar({
      branches: [
        { name: 'main', protected: true },
        { name: 'dev', protected: true },
        { name: 'qa', protected: true },
        { name: 'rc', protected: true },
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
        { name: 'rc', protected: true },
      ],
      arquivosCanonicos: [PR_TEMPLATE_PATH, BRANCHING_POLICY_PATH],
    });
    const { steps, diagnostics } = await plano;

    expect(steps).toEqual([]);
    expect(diagnostics).toEqual([]);
  });
});
