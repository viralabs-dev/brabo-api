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
});
