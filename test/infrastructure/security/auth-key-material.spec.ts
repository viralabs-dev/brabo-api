import { describe, it, expect, afterEach } from 'vitest';
import {
  passphraseAtual,
  pepperAtual,
} from '../../../src/infrastructure/security/auth-key-material';

/**
 * Passphrase que deriva o par Ed25519 do access token (RN-114, mesmo padrão
 * do `GIT_OAUTH_STATE_SECRET` — ADR 0059/RN-093).
 *
 * Mesma observação de `oauth-state-secret.spec.ts`: o caso que interessa não
 * é o feliz, é o de subir produção sem configurar. O default é público neste
 * repositório (`.env.example`), e o `docker-compose.prod.yml` o supria como
 * fallback — por isso o teste central não é "falha quando falta", é "falha
 * quando está DEFINIDA com o valor de exemplo".
 */

// Fixture DELIBERADAMENTE sem entropia — ver a mesma nota em
// oauth-state-secret.spec.ts sobre o Gitleaks recusar valor de alta entropia
// atribuído a uma env var de segredo.
const CHAVE_DE_TESTE = 'chave-de-teste-nao-e-segredo';

describe('passphraseAtual', () => {
  const nodeEnvOriginal = process.env.NODE_ENV;

  afterEach(() => {
    delete process.env.AUTH_JWT_SECRET;
    if (nodeEnvOriginal === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnvOriginal;
  });

  it('caminho feliz: em produção, devolve a chave configurada', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_JWT_SECRET = CHAVE_DE_TESTE;
    expect(passphraseAtual()).toBe(CHAVE_DE_TESTE);
  });

  it('em produção, a chave de EXEMPLO do repositório derruba o boot', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_JWT_SECRET = 'dev-auth-jwt-secret-change-me';
    expect(() => passphraseAtual()).toThrow(/valor de exemplo/i);
  });

  it('em produção, sem a variável, derruba o boot', () => {
    process.env.NODE_ENV = 'production';
    expect(() => passphraseAtual()).toThrow(/obrigatória em produção/i);
  });

  it('em produção, chave curta derruba o boot', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_JWT_SECRET = 'senha123';
    expect(() => passphraseAtual()).toThrow(/mínimo em produção/i);
  });

  it('em produção, espaço em volta não conta como chave', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_JWT_SECRET = '   ';
    expect(() => passphraseAtual()).toThrow(/obrigatória em produção/i);
  });

  it('fora de produção, sem a variável, cai no default de desenvolvimento', () => {
    process.env.NODE_ENV = 'development';
    expect(passphraseAtual()).toBe('dev-auth-jwt-secret-change-me');
  });

  it('fora de produção, chave curta é aceita', () => {
    process.env.NODE_ENV = 'development';
    process.env.AUTH_JWT_SECRET = 'curta';
    expect(passphraseAtual()).toBe('curta');
  });
});

/**
 * O pepper dos hashes de token (RN-613). Antes, sem `AUTH_TOKEN_PEPPER`, ele
 * caía no `AUTH_JWT_SECRET` em silêncio, e rotacionar o JWT deslogava todo
 * mundo. Agora é obrigatório em produção — e a recusa diz como migrar sem
 * deslogar ninguém, porque a correção óbvia (gerar um aleatório) é a que
 * desloga.
 */
describe('pepperAtual (RN-613)', () => {
  const nodeEnvOriginal = process.env.NODE_ENV;
  const PEPPER_DE_TESTE = 'pepper-de-teste-nao-e-segredo';

  afterEach(() => {
    delete process.env.AUTH_TOKEN_PEPPER;
    delete process.env.AUTH_JWT_SECRET;
    if (nodeEnvOriginal === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnvOriginal;
  });

  it('caminho feliz: em produção, devolve o pepper configurado', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_TOKEN_PEPPER = PEPPER_DE_TESTE;
    expect(pepperAtual()).toBe(PEPPER_DE_TESTE);
  });

  it('em produção, SEM o pepper, recusa — mesmo com AUTH_JWT_SECRET definido, e dizendo como migrar', () => {
    // O caso que o fallback antigo cobria em silêncio: JWT presente, pepper
    // ausente. A recusa é o ponto; a mensagem é o conserto.
    process.env.NODE_ENV = 'production';
    process.env.AUTH_JWT_SECRET = CHAVE_DE_TESTE;
    expect(() => pepperAtual()).toThrow(
      /AUTH_TOKEN_PEPPER é obrigatória em produção/,
    );
    expect(() => pepperAtual()).toThrow(
      /valor ATUAL de AUTH_JWT_SECRET para não deslogar ninguém/,
    );
  });

  it('em produção, espaço em volta não conta como pepper', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_TOKEN_PEPPER = '   ';
    expect(() => pepperAtual()).toThrow(/obrigatória em produção/);
  });

  it('em produção, os valores de EXEMPLO do repositório (o do pepper e o do JWT) derrubam o boot', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_TOKEN_PEPPER = 'dev-auth-token-pepper-change-me';
    expect(() => pepperAtual()).toThrow(/valor de exemplo/);
    process.env.AUTH_TOKEN_PEPPER = 'dev-auth-jwt-secret-change-me';
    expect(() => pepperAtual()).toThrow(/valor de exemplo/);
  });

  it('em produção, pepper curto derruba o boot', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_TOKEN_PEPPER = 'curto';
    expect(() => pepperAtual()).toThrow(/mínimo em produção/);
  });

  it('em produção, o pepper IGUAL ao AUTH_JWT_SECRET é aceito — é o estado de toda instalação migrada', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_JWT_SECRET = CHAVE_DE_TESTE;
    process.env.AUTH_TOKEN_PEPPER = CHAVE_DE_TESTE;
    expect(pepperAtual()).toBe(CHAVE_DE_TESTE);
  });

  it('fora de produção, sem a variável, cai no default do PEPPER — nunca no AUTH_JWT_SECRET', () => {
    process.env.NODE_ENV = 'development';
    process.env.AUTH_JWT_SECRET = CHAVE_DE_TESTE;
    expect(pepperAtual()).toBe('dev-auth-token-pepper-change-me');
  });
});
