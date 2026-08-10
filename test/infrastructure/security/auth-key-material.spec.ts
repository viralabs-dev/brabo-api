import { describe, it, expect, afterEach } from 'vitest';
import { passphraseAtual } from '../../../src/infrastructure/security/auth-key-material';

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
