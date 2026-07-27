import { describe, it, expect, afterEach } from 'vitest';
import { resolveCorsOrigins } from '../../../src/infrastructure/security/cors-origins';

/**
 * CORS estrito por ambiente (Fase 5, item 7).
 *
 * O caso que motiva estes testes não é o feliz — é o de esquecer a variável em
 * produção. Antes, isso fazia a api aceitar `http://localhost:5173` em silêncio;
 * agora derruba o boot, que é barulhento e reversível.
 */
describe('resolveCorsOrigins', () => {
  afterEach(() => {
    delete process.env.WEB_ORIGIN;
    delete process.env.NODE_ENV;
  });

  it('caminho feliz: lista separada por vírgula vira array, sem espaços', () => {
    process.env.WEB_ORIGIN = 'https://brabo.app, https://preview.brabo.app';
    expect(resolveCorsOrigins()).toEqual([
      'https://brabo.app',
      'https://preview.brabo.app',
    ]);
  });

  it('origem única continua funcionando', () => {
    process.env.WEB_ORIGIN = 'http://localhost:8088';
    expect(resolveCorsOrigins()).toEqual(['http://localhost:8088']);
  });

  it('fora de produção, sem WEB_ORIGIN, cai no default de desenvolvimento', () => {
    expect(resolveCorsOrigins()).toEqual(['http://localhost:5173']);
  });

  it('FALHA em produção sem WEB_ORIGIN — o default de dev não vale ali', () => {
    process.env.NODE_ENV = 'production';
    expect(() => resolveCorsOrigins()).toThrow(/obrigatória em produção/);
  });

  it('FALHA em produção com "*" — com credentials isso expõe resposta autenticada', () => {
    process.env.NODE_ENV = 'production';
    process.env.WEB_ORIGIN = 'https://brabo.app,*';
    expect(() => resolveCorsOrigins()).toThrow(/não pode ser "\*"/);
  });

  it('aceita "*" fora de produção — é o ambiente onde isso é conveniente e inofensivo', () => {
    process.env.WEB_ORIGIN = '*';
    expect(resolveCorsOrigins()).toEqual(['*']);
  });
});
