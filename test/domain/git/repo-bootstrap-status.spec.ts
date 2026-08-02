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
