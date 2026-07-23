import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  signOauthState,
  verifyOauthState,
} from '../../../src/domain/git/oauth-state';
import { InvalidOauthStateError } from '../../../src/domain/git/git-provider-errors';

const SECRET = 'test-secret';

afterEach(() => {
  vi.useRealTimers();
});

describe('oauth-state', () => {
  it('caminho feliz: assina e verifica, devolvendo o payload original', () => {
    const state = signOauthState(
      { projectId: 'p1', userId: 'u1', provider: 'github' },
      SECRET,
    );

    const payload = verifyOauthState(state, SECRET, 'github');

    expect(payload.projectId).toBe('p1');
    expect(payload.userId).toBe('u1');
    expect(payload.provider).toBe('github');
    expect(typeof payload.nonce).toBe('string');
  });

  it('rejeita state expirado (TTL de 10 minutos)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const state = signOauthState(
      { projectId: 'p1', userId: 'u1', provider: 'github' },
      SECRET,
    );

    vi.setSystemTime(new Date('2026-01-01T00:11:00Z')); // +11min, passou do TTL

    expect(() => verifyOauthState(state, SECRET, 'github')).toThrow(
      InvalidOauthStateError,
    );
  });

  it('rejeita assinatura de um secret diferente', () => {
    const state = signOauthState(
      { projectId: 'p1', userId: 'u1', provider: 'github' },
      SECRET,
    );
    expect(() => verifyOauthState(state, 'outro-secret', 'github')).toThrow(
      InvalidOauthStateError,
    );
  });

  it('rejeita adulteração de 1 byte no payload', () => {
    const state = signOauthState(
      { projectId: 'p1', userId: 'u1', provider: 'github' },
      SECRET,
    );
    const [encodedPayload, signature] = state.split('.');
    const tamperedPayload =
      encodedPayload.slice(0, -1) + (encodedPayload.endsWith('A') ? 'B' : 'A');
    const tampered = `${tamperedPayload}.${signature}`;

    expect(() => verifyOauthState(tampered, SECRET, 'github')).toThrow(
      InvalidOauthStateError,
    );
  });

  it('rejeita provider incompatível com o esperado na verificação', () => {
    const state = signOauthState(
      { projectId: 'p1', userId: 'u1', provider: 'github' },
      SECRET,
    );

    expect(() => verifyOauthState(state, SECRET, 'gitlab')).toThrow(
      InvalidOauthStateError,
    );
  });

  it('rejeita token malformado (sem separador)', () => {
    expect(() =>
      verifyOauthState('nao-e-um-state-valido', SECRET, 'github'),
    ).toThrow(InvalidOauthStateError);
  });
});
