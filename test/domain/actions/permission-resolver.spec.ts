import { describe, it, expect } from 'vitest';
import { resolvePermission } from '../../../src/domain/actions/permission-resolver';

describe('resolvePermission', () => {
  it('sem regras aplicáveis, cai no default require_approval', () => {
    expect(resolvePermission({ rules: [] }, 'shell.exec')).toBe(
      'require_approval',
    );
  });

  it('permissions null ou undefined também caem no default', () => {
    expect(resolvePermission(null, 'shell.exec')).toBe('require_approval');
    expect(resolvePermission(undefined, 'shell.exec')).toBe('require_approval');
  });

  it('regra exata casa', () => {
    const permissions = {
      rules: [{ actionType: 'shell.exec', policy: 'auto_approve' as const }],
    };
    expect(resolvePermission(permissions, 'shell.exec')).toBe('auto_approve');
  });

  it('wildcard de sufixo casa o prefixo mas não o prefixo sozinho', () => {
    const permissions = {
      rules: [{ actionType: 'shell.*', policy: 'deny' as const }],
    };
    expect(resolvePermission(permissions, 'shell.exec')).toBe('deny');
    expect(resolvePermission(permissions, 'shell')).toBe('require_approval');
  });

  it('primeira regra correspondente na ordem do array vence', () => {
    const permissions = {
      rules: [
        { actionType: 'shell.*', policy: 'deny' as const },
        { actionType: 'shell.exec', policy: 'auto_approve' as const },
      ],
    };
    expect(resolvePermission(permissions, 'shell.exec')).toBe('deny');
  });
});
