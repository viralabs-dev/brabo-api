import { describe, it, expect, afterEach } from 'vitest';
import { Ed25519AccessTokenIssuer } from '../../../src/infrastructure/security/ed25519-access-token-issuer';
import { decodeProtectedHeader, decodeJwt } from 'jose';

const SEGREDO_A = 'segredo-de-teste-a';
const SEGREDO_B = 'segredo-de-teste-b';

/**
 * As chaves são derivadas no PRIMEIRO uso e memoizadas, então cada cenário
 * monta a sua instância depois de mexer no ambiente. Uma instância só,
 * compartilhada, carregaria a chave do primeiro teste para os outros.
 */
function comAmbiente(atual: string, anterior?: string) {
  process.env.AUTH_JWT_SECRET = atual;
  if (anterior) process.env.AUTH_JWT_SECRET_PREVIOUS = anterior;
  else delete process.env.AUTH_JWT_SECRET_PREVIOUS;
  return new Ed25519AccessTokenIssuer();
}

afterEach(() => {
  delete process.env.AUTH_JWT_SECRET;
  delete process.env.AUTH_JWT_SECRET_PREVIOUS;
});

describe('Ed25519AccessTokenIssuer', () => {
  it('caminho feliz: emite e verifica, preservando as claims', async () => {
    const issuer = comAmbiente(SEGREDO_A);
    const { token, expiresIn } = await issuer.emitir({
      userId: 'u-1',
      email: 'alguem@brabo.dev',
    });

    expect(expiresIn).toBe(900);
    await expect(issuer.verificar(token)).resolves.toEqual({
      userId: 'u-1',
      email: 'alguem@brabo.dev',
    });
  });

  it('assina com EdDSA e carrega o kid no cabeçalho', async () => {
    const issuer = comAmbiente(SEGREDO_A);
    const { token } = await issuer.emitir({ userId: 'u-1', email: 'a@b.dev' });

    const header = decodeProtectedHeader(token);
    const { keys } = await issuer.jwks();

    expect(header.alg).toBe('EdDSA');
    expect(header.kid).toBe(keys[0].kid);
  });

  it('recusa token assinado por outra chave', async () => {
    const emissor = comAmbiente(SEGREDO_A);
    const { token } = await emissor.emitir({ userId: 'u-1', email: 'a@b.dev' });

    const outro = comAmbiente(SEGREDO_B);
    await expect(outro.verificar(token)).rejects.toThrow();
  });

  it('recusa token expirado', async () => {
    process.env.AUTH_ACCESS_TOKEN_TTL_MS = '0';
    const issuer = comAmbiente(SEGREDO_A);
    const { token } = await issuer.emitir({ userId: 'u-1', email: 'a@b.dev' });
    delete process.env.AUTH_ACCESS_TOKEN_TTL_MS;

    // exp == iat, então já nasce fora da janela.
    expect(decodeJwt(token).exp).toBe(decodeJwt(token).iat);
    await expect(issuer.verificar(token)).rejects.toThrow();
  });

  describe('rotação de chave', () => {
    it('token da chave ANTERIOR ainda verifica', async () => {
      const antigo = comAmbiente(SEGREDO_B);
      const { token } = await antigo.emitir({
        userId: 'u-1',
        email: 'a@b.dev',
      });

      const emRotacao = comAmbiente(SEGREDO_A, SEGREDO_B);
      await expect(emRotacao.verificar(token)).resolves.toEqual({
        userId: 'u-1',
        email: 'a@b.dev',
      });
    });

    it('token NOVO sai assinado pela chave atual, nunca pela anterior', async () => {
      const emRotacao = comAmbiente(SEGREDO_A, SEGREDO_B);
      const { token } = await emRotacao.emitir({
        userId: 'u-1',
        email: 'a@b.dev',
      });

      const { keys } = await emRotacao.jwks();
      const soAtual = comAmbiente(SEGREDO_A);

      expect(decodeProtectedHeader(token).kid).toBe(keys[0].kid);
      await expect(soAtual.verificar(token)).resolves.toBeTruthy();
    });

    it('o JWKS publica as duas chaves durante a rotação, e uma fora dela', async () => {
      const emRotacao = await comAmbiente(SEGREDO_A, SEGREDO_B).jwks();
      const normal = await comAmbiente(SEGREDO_A).jwks();

      expect(emRotacao.keys).toHaveLength(2);
      expect(normal.keys).toHaveLength(1);
      expect(emRotacao.keys[0].kid).not.toBe(emRotacao.keys[1].kid);
    });

    it('_PREVIOUS igual à atual não conta como rotação', async () => {
      // Senão o JWKS publicaria a mesma chave duas vezes e a verificação
      // pagaria o dobro do custo sem motivo.
      const { keys } = await comAmbiente(SEGREDO_A, SEGREDO_A).jwks();
      expect(keys).toHaveLength(1);
    });
  });

  it('o JWKS não vaza a chave privada', async () => {
    const { keys } = await comAmbiente(SEGREDO_A).jwks();
    // `d` é o componente privado de uma JWK OKP. Se ele aparecer aqui, a rota
    // pública de JWKS estaria publicando a chave de assinatura.
    expect(keys[0]).not.toHaveProperty('d');
    expect(keys[0]).toMatchObject({ kty: 'OKP', crv: 'Ed25519', use: 'sig' });
  });
});
