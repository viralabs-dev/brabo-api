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
