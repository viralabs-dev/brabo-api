import { describe, it, expect } from 'vitest';
import {
  decide,
  type ActionType,
  type DecideContext,
} from '../../../src/domain/actions/decide';
import { EMPTY_PERMISSIONS_FILE } from '../../../src/domain/actions/permissions-file';

/** A regra aceita da oferta (RN-1437, AT-998): só sobe `require_approval`, nunca passa de um teto. */
const ctx = (o: Partial<DecideContext> = {}): DecideContext => ({
  effectiveRole: 'maintainer',
  autonomyMode: null,
  permissionsFile: EMPTY_PERMISSIONS_FILE,
  regraDeAutomacaoDaAprovacao: true,
  ...o,
});

describe('decide — regra da oferta (RN-1437)', () => {
  it('com a regra, container_start vira auto_approve e diz que foi por automação', () => {
    const d = decide({ actionType: 'container_start' }, ctx());
    expect(d.policy).toBe('auto_approve');
    expect(d.porAutomacao).toBe(true);
  });

  it('sem a regra, o veredito de sempre', () => {
    expect(
      decide(
        { actionType: 'container_start' },
        ctx({ regraDeAutomacaoDaAprovacao: false }),
      ).policy,
    ).toBe('require_approval');
  });

  it.each<ActionType>([
    'git_merge',
    'git_push',
    'container_remove',
    'parallelize',
    'terminal',
  ])('%s continua pedindo aprovação mesmo com a regra', (actionType) => {
    expect(
      decide({ actionType, command: 'echo oi', targetBranch: 'main' }, ctx())
        .policy,
    ).toBe('require_approval');
  });

  it('open_infra_pr é a exceção ao teto; com run.app continua pedindo (RN-933)', () => {
    expect(decide({ actionType: 'open_infra_pr' }, ctx()).policy).toBe(
      'auto_approve',
    );
    expect(
      decide({ actionType: 'open_infra_pr', comAppDeclarado: true }, ctx())
        .policy,
    ).toBe('require_approval');
  });

  it('nunca desfaz um deny (papel insuficiente)', () => {
    expect(
      decide(
        { actionType: 'container_start' },
        ctx({ effectiveRole: 'viewer' }),
      ).policy,
    ).toBe('deny');
  });
});
