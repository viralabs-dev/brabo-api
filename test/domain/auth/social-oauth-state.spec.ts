import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  signSocialOauthState,
  verifySocialOauthState,
} from '../../../src/domain/auth/social-oauth-state';
import { InvalidSocialOauthStateError } from '../../../src/domain/auth/social-oauth-errors';
import { signOauthState } from '../../../src/domain/git/oauth-state';

const SECRET = 'test-secret';

afterEach(() => {
  vi.useRealTimers();
});

describe('social-oauth-state', () => {
  it('caminho feliz: assina e verifica, devolvendo o payload original', () => {
    const state = signSocialOauthState('github', SECRET);

    const payload = verifySocialOauthState(state, SECRET, 'github');

    expect(payload.provider).toBe('github');
    expect(payload.purpose).toBe('social_login');
    expect(typeof payload.nonce).toBe('string');
  });

  it('rejeita state expirado (TTL de 10 minutos)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const state = signSocialOauthState('github', SECRET);

    vi.setSystemTime(new Date('2026-01-01T00:11:00Z')); // +11min, passou do TTL

    expect(() => verifySocialOauthState(state, SECRET, 'github')).toThrow(
      InvalidSocialOauthStateError,
    );
  });

  it('rejeita assinatura de um secret diferente', () => {
    const state = signSocialOauthState('github', SECRET);
    expect(() =>
      verifySocialOauthState(state, 'outro-secret', 'github'),
    ).toThrow(InvalidSocialOauthStateError);
  });

  it('rejeita adulteração de 1 byte no payload', () => {
    const state = signSocialOauthState('github', SECRET);
    const [encodedPayload, signature] = state.split('.');
    const tamperedPayload =
      encodedPayload.slice(0, -1) + (encodedPayload.endsWith('A') ? 'B' : 'A');
    const tampered = `${tamperedPayload}.${signature}`;

    expect(() => verifySocialOauthState(tampered, SECRET, 'github')).toThrow(
      InvalidSocialOauthStateError,
    );
  });

  it('rejeita provider incompatível com o esperado na verificação', () => {
    const state = signSocialOauthState('github', SECRET);
    expect(() => verifySocialOauthState(state, SECRET, 'gitlab')).toThrow(
      InvalidSocialOauthStateError,
    );
  });

  it('rejeita token malformado (sem separador)', () => {
    expect(() =>
      verifySocialOauthState('nao-e-um-state-valido', SECRET, 'github'),
    ).toThrow(InvalidSocialOauthStateError);
  });

  /**
   * RN-273 — a garantia central deste módulo. Mesmo assinado com a MESMA
   * chave (as duas rotas reusam `GIT_OAUTH_STATE_SECRET`), um `state`
   * legitimamente emitido para "conectar git ao projeto X"
   * (`domain/git/oauth-state.ts`) NÃO é aceito aqui — o payload não carrega
   * `purpose: 'social_login'`, e é o primeiro campo checado.
   */
  it('RN-273: rejeita um state do fluxo de CONEXÃO de git, mesma chave', () => {
    const stateDeConexao = signOauthState(
      { projectId: 'p1', userId: 'u1', provider: 'github' },
      SECRET,
    );

    expect(() =>
      verifySocialOauthState(stateDeConexao, SECRET, 'github'),
    ).toThrow(InvalidSocialOauthStateError);
  });
});
