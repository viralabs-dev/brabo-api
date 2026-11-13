import { describe, it, expect } from 'vitest';
import {
  decide,
  type DecideAction,
  type DecideContext,
} from '../../../src/domain/actions/decide';
import { EMPTY_PERMISSIONS_FILE } from '../../../src/domain/actions/permissions-file';

/** A exceção da trava de merge (RN-1316, AT-902): chave + origem + branch de trabalho. */
function ctx(overrides: Partial<DecideContext> = {}): DecideContext {
  return {
    effectiveRole: 'maintainer',
    autonomyMode: null,
    permissionsFile: EMPTY_PERMISSIONS_FILE,
    mergeAutomaticoDoProjeto: true,
    ...overrides,
  };
}
const gatilho: DecideAction = {
  actionType: 'git_merge',
  targetBranch: 'main',
  origem: 'merge_automatico',
};

describe('decide — merge automático (RN-1316)', () => {
  it('caminho feliz: chave ligada + origem + branch de trabalho = auto_approve', () => {
    expect(decide(gatilho, ctx()).policy).toBe('auto_approve');
  });

  it('chave desligada ou ausente: o veredito de hoje (require_approval)', () => {
    expect(
      decide(gatilho, ctx({ mergeAutomaticoDoProjeto: false })).policy,
    ).toBe('require_approval');
    expect(
      decide(gatilho, ctx({ mergeAutomaticoDoProjeto: undefined })).policy,
    ).toBe('require_approval');
  });

  it('chave desligada: nem autonomia nem permissions.json auto-aprovam, mesmo com origem', () => {
    const r = decide(
      gatilho,
      ctx({
        mergeAutomaticoDoProjeto: false,
        autonomyMode: 'auto_approve',
        permissionsFile: { ...EMPTY_PERMISSIONS_FILE, allow: ['GitMerge()'] },
      }),
    );
    expect(r.policy).toBe('require_approval');
  });

  it('chave ligada SEM origem (pessoa, agente, sempre permitir, permissions.json) segue rebaixada', () => {
    const r = decide(
      { actionType: 'git_merge', targetBranch: 'main' },
      ctx({
        autonomyMode: 'auto_approve',
        permissionsFile: { ...EMPTY_PERMISSIONS_FILE, allow: ['GitMerge()'] },
      }),
    );
    expect(r.policy).toBe('require_approval');
  });

  it('chave ligada + origem em outra branch protegida (dev/qa/rc) segue rebaixada', () => {
    for (const targetBranch of ['dev', 'qa', 'rc']) {
      expect(decide({ ...gatilho, targetBranch }, ctx()).policy).toBe(
        'require_approval',
      );
    }
  });

  it('a origem só vale para git_merge', () => {
    expect(
      decide(
        { actionType: 'git_push', origem: 'merge_automatico' },
        ctx({ mergeAutomaticoDoProjeto: true }),
      ).policy,
    ).not.toBe('auto_approve');
  });

  it('deny vence: papel insuficiente nega mesmo com as três condições', () => {
    expect(decide(gatilho, ctx({ effectiveRole: 'developer' })).policy).toBe(
      'deny',
    );
    expect(decide(gatilho, ctx({ effectiveRole: null })).policy).toBe('deny');
  });

  it('a chave é lida por proposta: ligada num contexto, desligada no seguinte', () => {
    expect(decide(gatilho, ctx()).policy).toBe('auto_approve');
    expect(
      decide(gatilho, ctx({ mergeAutomaticoDoProjeto: false })).policy,
    ).toBe('require_approval');
  });
});
