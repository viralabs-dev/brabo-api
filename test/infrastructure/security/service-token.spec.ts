import { describe, it, expect, afterEach } from 'vitest';
import { tokenDeServicoAtual } from '../../../src/infrastructure/security/service-token';

/**
 * Segredo compartilhado do tráfego interno api <-> engine (RN-110, mesmo
 * padrão do `GIT_OAUTH_STATE_SECRET` — ADR 0059/RN-093).
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
const TOKEN_DE_TESTE = 'token-de-teste-nao-e-segredo';

describe('tokenDeServicoAtual', () => {
  const nodeEnvOriginal = process.env.NODE_ENV;

  afterEach(() => {
    delete process.env.BRABO_SERVICE_TOKEN;
    if (nodeEnvOriginal === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnvOriginal;
  });

  it('caminho feliz: em produção, devolve o token configurado', () => {
    process.env.NODE_ENV = 'production';
    process.env.BRABO_SERVICE_TOKEN = TOKEN_DE_TESTE;
    expect(tokenDeServicoAtual()).toBe(TOKEN_DE_TESTE);
  });

  it('em produção, o token de EXEMPLO do repositório derruba o boot', () => {
    process.env.NODE_ENV = 'production';
    process.env.BRABO_SERVICE_TOKEN = 'dev-service-token-change-me';
    expect(() => tokenDeServicoAtual()).toThrow(/valor de exemplo/i);
  });

  it('em produção, sem a variável, derruba o boot', () => {
    process.env.NODE_ENV = 'production';
    expect(() => tokenDeServicoAtual()).toThrow(/obrigatória em produção/i);
  });

  it('em produção, token curto derruba o boot', () => {
    process.env.NODE_ENV = 'production';
    process.env.BRABO_SERVICE_TOKEN = 'senha123';
    expect(() => tokenDeServicoAtual()).toThrow(/mínimo em produção/i);
  });

  it('em produção, espaço em volta não conta como token', () => {
    process.env.NODE_ENV = 'production';
    process.env.BRABO_SERVICE_TOKEN = '   ';
    expect(() => tokenDeServicoAtual()).toThrow(/obrigatória em produção/i);
  });

  it('fora de produção, sem a variável, cai no default de desenvolvimento', () => {
    process.env.NODE_ENV = 'development';
    expect(tokenDeServicoAtual()).toBe('dev-service-token-change-me');
  });

  it('fora de produção, token curto é aceito', () => {
    process.env.NODE_ENV = 'development';
    process.env.BRABO_SERVICE_TOKEN = 'curto';
    expect(tokenDeServicoAtual()).toBe('curto');
  });
});
