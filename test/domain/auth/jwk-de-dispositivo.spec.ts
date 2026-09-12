import { describe, expect, it } from 'vitest';
import {
  exigirJwkPublicaEd25519,
  JwkDeDispositivoInvalidaError,
} from '../../../src/domain/auth/jwk-de-dispositivo';

/**
 * A régua ÚNICA de forma da JWK de dispositivo (RN-552), chamada pelos DOIS
 * registradores — o do navegador (ADR 0118) e o do instalador (ADR 0155
 * ponto 4).
 *
 * O caso que esta extração acrescenta é o `d`: antes, uma chave PRIVADA
 * mandada por engano de quem serializou o par inteiro passava na checagem
 * (ela tem `kty`, `crv` e `x` como qualquer pública) e era GRAVADA — a única
 * coisa que o desenho das duas espécies de chave promete que nunca viaja.
 */
describe('exigirJwkPublicaEd25519 (RN-552)', () => {
  it('caminho feliz: uma pública Ed25519 passa', () => {
    expect(() =>
      exigirJwkPublicaEd25519(
        JSON.stringify({ kty: 'OKP', crv: 'Ed25519', x: 'ZGVhZGJlZWY' }),
      ),
    ).not.toThrow();
  });

  it('chave PRIVADA (tem "d"): recusa, e a mensagem diz o que chegou', () => {
    let capturado: unknown;
    try {
      exigirJwkPublicaEd25519(
        JSON.stringify({
          kty: 'OKP',
          crv: 'Ed25519',
          x: 'ZGVhZGJlZWY',
          d: 'ZGVhZGJlZWY',
        }),
      );
    } catch (erro) {
      capturado = erro;
    }

    expect(capturado).toBeInstanceOf(JwkDeDispositivoInvalidaError);
    expect((capturado as Error).message).toContain('PRIVADA');
  });

  it('JSON inválido, curva errada e "x" ausente: recusa nos três', () => {
    for (const entrada of [
      '{ isto não é json',
      JSON.stringify({ kty: 'RSA', n: 'x', e: 'AQAB' }),
      JSON.stringify({ kty: 'OKP', crv: 'X25519', x: 'ZGVhZGJlZWY' }),
      JSON.stringify({ kty: 'OKP', crv: 'Ed25519' }),
      JSON.stringify({ kty: 'OKP', crv: 'Ed25519', x: '' }),
      JSON.stringify(['nem é objeto']),
    ]) {
      expect(() => exigirJwkPublicaEd25519(entrada)).toThrow(
        JwkDeDispositivoInvalidaError,
      );
    }
  });

  it('a curva errada é dita ANTES do "d" — quem manda uma X25519 privada ouve o problema maior', () => {
    let capturado: unknown;
    try {
      exigirJwkPublicaEd25519(
        JSON.stringify({ kty: 'OKP', crv: 'X25519', x: 'abc', d: 'abc' }),
      );
    } catch (erro) {
      capturado = erro;
    }
    expect((capturado as Error).message).toContain('Ed25519');
  });
});
