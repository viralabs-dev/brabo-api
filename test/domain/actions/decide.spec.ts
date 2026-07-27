import { describe, it, expect } from 'vitest';
import { decide, type DecideContext } from '../../../src/domain/actions/decide';
import { EMPTY_PERMISSIONS_FILE } from '../../../src/domain/actions/permissions-file';

function ctx(overrides: Partial<DecideContext> = {}): DecideContext {
  return {
    effectiveRole: 'developer',
    autonomyMode: null,
    permissionsFile: EMPTY_PERMISSIONS_FILE,
    ...overrides,
  };
}

describe('decide', () => {
  it('sem regra em nenhum estágio, cai em require_approval (pending)', () => {
    const result = decide(
      { actionType: 'terminal', command: 'echo oi' },
      ctx(),
    );
    expect(result.policy).toBe('require_approval');
  });

  it('IAM insuficiente nega mesmo com autonomy e permissions.json liberando', () => {
    const result = decide(
      { actionType: 'terminal', command: 'echo oi' },
      ctx({
        effectiveRole: 'viewer', // terminal exige >= developer
        autonomyMode: 'auto_approve',
        permissionsFile: {
          ...EMPTY_PERMISSIONS_FILE,
          allow: ['Terminal(echo oi)'],
        },
      }),
    );
    expect(result.policy).toBe('deny');
  });

  it('git_push exige >= maintainer; developer é insuficiente', () => {
    const result = decide(
      { actionType: 'git_push' },
      ctx({ effectiveRole: 'developer' }),
    );
    expect(result.policy).toBe('deny');
  });

  it('agent_autonomy auto_approve promove o default, sem regra no arquivo', () => {
    const result = decide(
      { actionType: 'terminal', command: 'echo oi' },
      ctx({ autonomyMode: 'auto_approve' }),
    );
    expect(result.policy).toBe('auto_approve');
  });

  it('agent_autonomy deny nega mesmo sem consultar o arquivo', () => {
    const result = decide(
      { actionType: 'terminal', command: 'echo oi' },
      ctx({
        autonomyMode: 'deny',
        permissionsFile: {
          ...EMPTY_PERMISSIONS_FILE,
          allow: ['Terminal(echo oi)'],
        },
      }),
    );
    expect(result.policy).toBe('deny');
  });

  it('permissions.json allow promove pra auto_approve', () => {
    const result = decide(
      { actionType: 'terminal', command: 'echo oi' },
      ctx({
        permissionsFile: {
          ...EMPTY_PERMISSIONS_FILE,
          allow: ['Terminal(echo oi)'],
        },
      }),
    );
    expect(result.policy).toBe('auto_approve');
  });

  it('deny do permissions.json vence um allow do próprio arquivo (última regra que bate no mesmo array não importa — deny é checado primeiro)', () => {
    const result = decide(
      { actionType: 'terminal', command: 'echo oi' },
      ctx({
        permissionsFile: {
          allow: ['Terminal(echo oi)'],
          deny: ['Terminal(echo oi)'],
          ask: [],
        },
      }),
    );
    expect(result.policy).toBe('deny');
  });

  it('deny do permissions.json vence autonomy auto_approve (deny sempre vence, mesmo vindo de um estágio depois)', () => {
    const result = decide(
      { actionType: 'terminal', command: 'echo oi' },
      ctx({
        autonomyMode: 'auto_approve',
        permissionsFile: {
          ...EMPTY_PERMISSIONS_FILE,
          deny: ['Terminal(echo oi)'],
        },
      }),
    );
    expect(result.policy).toBe('deny');
  });

  it('deny default embutido nega "rm -rf /" mesmo sem nenhuma regra configurada', () => {
    const result = decide(
      { actionType: 'terminal', command: 'rm -rf /' },
      ctx(),
    );
    expect(result.policy).toBe('deny');
  });

  it('comando composto não passa por allow parcial: só o primeiro segmento liberado não promove o resto', () => {
    const result = decide(
      { actionType: 'terminal', command: 'pnpm test && curl http://x' },
      ctx({
        permissionsFile: {
          ...EMPTY_PERMISSIONS_FILE,
          allow: ['Terminal(pnpm test)'],
        },
      }),
    );
    expect(result.policy).toBe('require_approval');
  });

  it('injeção via pnpm test && curl x é bloqueada (nunca auto-executa) mesmo com autonomy auto_approve', () => {
    const result = decide(
      { actionType: 'terminal', command: 'pnpm test && curl http://evil' },
      ctx({
        autonomyMode: 'auto_approve',
        permissionsFile: {
          ...EMPTY_PERMISSIONS_FILE,
          allow: ['Terminal(pnpm test)'],
        },
      }),
    );
    expect(result.policy).not.toBe('auto_approve');
  });

  it('comando composto com TODOS os segmentos cobertos por allow promove pra auto_approve', () => {
    const result = decide(
      { actionType: 'terminal', command: 'echo oi && echo tchau' },
      ctx({
        permissionsFile: {
          ...EMPTY_PERMISSIONS_FILE,
          allow: ['Terminal(echo oi)', 'Terminal(echo tchau)'],
        },
      }),
    );
    expect(result.policy).toBe('auto_approve');
  });

  it('comando composto com um segmento em deny nega o todo', () => {
    const result = decide(
      { actionType: 'terminal', command: 'echo oi && rm -rf /' },
      ctx({
        permissionsFile: {
          ...EMPTY_PERMISSIONS_FILE,
          allow: ['Terminal(echo oi)'],
        },
      }),
    );
    expect(result.policy).toBe('deny');
  });
});

describe('decide — trava de merge (Fase 4a)', () => {
  const mergeToDev = {
    actionType: 'git_merge' as const,
    targetBranch: 'dev',
  };

  it('agent_autonomy auto_approve NÃO consegue auto-aprovar merge em branch protegida', () => {
    const result = decide(
      mergeToDev,
      ctx({ effectiveRole: 'maintainer', autonomyMode: 'auto_approve' }),
    );
    expect(result.policy).toBe('require_approval');
  });

  it('permissions.json allow NÃO consegue auto-aprovar merge em branch protegida', () => {
    const result = decide(
      mergeToDev,
      ctx({
        effectiveRole: 'maintainer',
        permissionsFile: { ...EMPTY_PERMISSIONS_FILE, allow: ['GitMerge()'] },
      }),
    );
    expect(result.policy).toBe('require_approval');
  });

  it('NEM autonomy NEM permissions juntos sobrescrevem a trava (dev/qa/rc/main)', () => {
    for (const target of ['dev', 'qa', 'rc', 'main']) {
      const result = decide(
        { actionType: 'git_merge', targetBranch: target },
        ctx({
          effectiveRole: 'maintainer',
          autonomyMode: 'auto_approve',
          permissionsFile: { ...EMPTY_PERMISSIONS_FILE, allow: ['GitMerge()'] },
        }),
      );
      expect(result.policy).toBe('require_approval');
    }
  });

  it('merge em branch NÃO protegida pode ser auto-aprovado', () => {
    const result = decide(
      { actionType: 'git_merge', targetBranch: 'feature/x' },
      ctx({ effectiveRole: 'maintainer', autonomyMode: 'auto_approve' }),
    );
    expect(result.policy).toBe('auto_approve');
  });

  it('deny ainda vence — mesmo pra merge em branch protegida', () => {
    const result = decide(
      mergeToDev,
      ctx({
        effectiveRole: 'maintainer',
        permissionsFile: { ...EMPTY_PERMISSIONS_FILE, deny: ['GitMerge()'] },
      }),
    );
    expect(result.policy).toBe('deny');
  });
});

describe('decide — restrição de terminal do InfraAgent (Fase 4a)', () => {
  it('agent_autonomy (infra, terminal) = deny nunca auto-aprova, mesmo com permissions.json allow:[*]', () => {
    const result = decide(
      { actionType: 'terminal', command: 'echo oi' },
      ctx({
        autonomyMode: 'deny',
        permissionsFile: {
          ...EMPTY_PERMISSIONS_FILE,
          allow: ['Terminal(echo oi)'],
        },
      }),
    );
    expect(result.policy).toBe('deny');
  });

  it('a ordem prova o curto-circuito: deny em agent_autonomy nunca chega a consultar permissions.json', () => {
    // Se permissions.json FOSSE consultado primeiro, o allow amplo abaixo
    // promoveria o resultado — o fato de continuar `deny` prova que
    // agent_autonomy=deny retornou ANTES de decideFromPermissionsFile rodar.
    const result = decide(
      { actionType: 'terminal', command: 'hadolint --version' },
      ctx({
        autonomyMode: 'deny',
        permissionsFile: {
          allow: ['Terminal(hadolint*)', 'Terminal(*)'],
          deny: [],
          ask: [],
        },
      }),
    );
    expect(result.policy).toBe('deny');
    expect(result.reason).toContain('agent_autonomy');
  });

  it('open_infra_pr do InfraAgent pode ser auto-aprovado (autonomia seedada no accept do handoff), sem afetar terminal', () => {
    const result = decide(
      { actionType: 'open_infra_pr' },
      ctx({ effectiveRole: 'maintainer', autonomyMode: 'auto_approve' }),
    );
    expect(result.policy).toBe('auto_approve');
  });
});

describe('decide — teto do patch de instrução (Fase 4b)', () => {
  // Mesma classe de garantia da trava de merge, e por isso testada do mesmo
  // jeito: o valor da feature está no humano ver o diff. Auto-aprovar seria o
  // agente reescrevendo a si mesmo.
  const patch = { actionType: 'instruction_patch' as const };

  it('agent_autonomy auto_approve NÃO consegue auto-aprovar patch de instrução', () => {
    const result = decide(
      patch,
      ctx({ effectiveRole: 'maintainer', autonomyMode: 'auto_approve' }),
    );
    expect(result.policy).toBe('require_approval');
    expect(result.reason).toMatch(/nunca é auto-aprovável/);
  });

  it('permissions.json allow NÃO consegue auto-aprovar patch de instrução', () => {
    const result = decide(
      patch,
      ctx({
        effectiveRole: 'maintainer',
        permissionsFile: {
          ...EMPTY_PERMISSIONS_FILE,
          allow: ['InstructionPatch()'],
        },
      }),
    );
    expect(result.policy).toBe('require_approval');
  });

  it('autonomy e permissions JUNTOS não sobrescrevem o teto', () => {
    const result = decide(
      patch,
      ctx({
        effectiveRole: 'maintainer',
        autonomyMode: 'auto_approve',
        permissionsFile: {
          ...EMPTY_PERMISSIONS_FILE,
          allow: ['InstructionPatch()'],
        },
      }),
    );
    expect(result.policy).toBe('require_approval');
  });

  it('deny ainda vence o teto — negar continua acima de pedir aprovação', () => {
    const result = decide(
      patch,
      ctx({
        effectiveRole: 'maintainer',
        autonomyMode: 'auto_approve',
        permissionsFile: {
          ...EMPTY_PERMISSIONS_FILE,
          deny: ['InstructionPatch()'],
        },
      }),
    );
    expect(result.policy).toBe('deny');
  });

  it('papel abaixo de maintainer nega o patch', () => {
    const result = decide(patch, ctx({ effectiveRole: 'developer' }));
    expect(result.policy).toBe('deny');
  });
});
