import { describe, it, expect } from 'vitest';
import { deriveProvisioningStatus } from '../../../src/domain/git/repo-bootstrap-status';
import type { RepoBootstrap } from '../../../src/domain/git/repo-bootstrap.entity';

function bootstrap(overrides: Partial<RepoBootstrap>): RepoBootstrap {
  return {
    id: 'bootstrap-1',
    projectId: 'project-1',
    sessionId: 'session-1',
    step: 'create_dev_branch',
    status: 'pending',
    attempts: 0,
    lastError: null,
    origin: 'created',
    plan: null,
    planGeneratedAt: null,
    planDecision: null,
    planDecidedAt: null,
    planDecidedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('deriveProvisioningStatus', () => {
  it('sem linha nenhuma: null (nunca começou a provisionar)', () => {
    expect(deriveProvisioningStatus(null)).toBeNull();
  });

  /**
   * A falha que acontece ANTES de existir linha de bootstrap.
   *
   * `ProvisionRepositoryUseCase` só cria o cursor depois de o provider
   * confirmar o repositório — uma recusa em `createRepo` (permissão negada no
   * disco, nome já em uso, 401 do provider) deixava o projeto com ZERO linha.
   * Sem este segundo argumento, "falhou ao criar" e "nunca tentou" eram o
   * mesmo `null`, e a tela mostrava "Iniciando provisionamento…" para sempre.
   */
  it('sem linha, mas com falha na CRIAÇÃO: provision_failed', () => {
    expect(
      deriveProvisioningStatus(null, 'permissão negada: /data/git-repos/x.git'),
    ).toBe('provision_failed');
  });

  it('sem linha e sem falha de criação: segue null', () => {
    expect(deriveProvisioningStatus(null, null)).toBeNull();
    expect(deriveProvisioningStatus(null, undefined)).toBeNull();
  });

  /**
   * Com linha, quem manda é a linha. Uma falha de criação ANTIGA não pode
   * reabrir um provisionamento que já retomou e converge — senão um projeto
   * consertado continuaria reportando o fracasso de antes.
   */
  it('com linha, a falha de criação antiga é IGNORADA', () => {
    expect(
      deriveProvisioningStatus(
        bootstrap({ step: 'protect_branches', status: 'done' }),
        'permissão negada: /data/git-repos/x.git',
      ),
    ).toBe('provisioned');
  });

  /**
   * `pending` é o estado em que a linha NASCE, e ele cai no catch-all
   * `provisioning` — indistinguível de "rodando". Como o bootstrap é síncrono
   * dentro do request, uma linha `pending` depois que o POST terminou é sempre
   * um travamento; a tela é quem tem o teto de espera (RN-474). Este caso
   * existe para fixar a leitura: nenhum teste cobria `pending` puro.
   */
  it('pending puro: provisioning (o catch-all)', () => {
    expect(deriveProvisioningStatus(bootstrap({ status: 'pending' }))).toBe(
      'provisioning',
    );
  });

  it('status failed em qualquer passo: provision_failed', () => {
    expect(
      deriveProvisioningStatus(
        bootstrap({ step: 'create_qa_branch', status: 'failed' }),
      ),
    ).toBe('provision_failed');
  });

  it('último passo done: provisioned', () => {
    expect(
      deriveProvisioningStatus(
        bootstrap({ step: 'protect_branches', status: 'done' }),
      ),
    ).toBe('provisioned');
  });

  it('passo intermediário done (não é o último): provisioning', () => {
    expect(
      deriveProvisioningStatus(
        bootstrap({ step: 'create_dev_branch', status: 'done' }),
      ),
    ).toBe('provisioning');
  });

  it('último passo mas status running (ainda não convergiu): provisioning', () => {
    expect(
      deriveProvisioningStatus(
        bootstrap({ step: 'protect_branches', status: 'running' }),
      ),
    ).toBe('provisioning');
  });

  // --- Adoção (Fase 12a) ---

  it('plano gerado e não decidido: awaiting_plan_decision, não provisioning', () => {
    // Nada está acontecendo nem vai acontecer sem decisão humana —
    // chamar isso de "provisionando" faria o Dashboard fazer poll de um
    // trabalho que não existe.
    expect(
      deriveProvisioningStatus(
        bootstrap({
          origin: 'adopted',
          plan: { generatedAt: 'agora', steps: [], diagnostics: [] },
          planGeneratedAt: new Date(),
        }),
      ),
    ).toBe('awaiting_plan_decision');
  });

  it('adotado como está: provisioned com o cursor intocado', () => {
    // O bootstrap foi DISPENSADO por decisão, e o cursor continua
    // dizendo a verdade (nenhum passo rodou). É a decisão que torna o
    // projeto operável, não um cursor adulterado — que era o que o seed
    // manual da Fase 10 fazia à mão.
    expect(
      deriveProvisioningStatus(
        bootstrap({
          origin: 'adopted',
          step: 'create_dev_branch',
          status: 'pending',
          plan: { generatedAt: 'agora', steps: [], diagnostics: [] },
          planDecision: 'as_is',
        }),
      ),
    ).toBe('provisioned');
  });

  it('plano aprovado e ainda rodando: provisioning', () => {
    expect(
      deriveProvisioningStatus(
        bootstrap({
          origin: 'adopted',
          step: 'create_qa_branch',
          status: 'running',
          plan: { generatedAt: 'agora', steps: [], diagnostics: [] },
          planDecision: 'approved',
        }),
      ),
    ).toBe('provisioning');
  });

  it('falha vence a decisão: plano aprovado que quebrou é provision_failed', () => {
    expect(
      deriveProvisioningStatus(
        bootstrap({
          origin: 'adopted',
          step: 'create_qa_branch',
          status: 'failed',
          plan: { generatedAt: 'agora', steps: [], diagnostics: [] },
          planDecision: 'approved',
        }),
      ),
    ).toBe('provision_failed');
  });
});
