import { describe, it, expect, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import helmet from 'helmet';
import request from 'supertest';
import {
  cspDirectives,
  helmetOptions,
} from '../../../src/infrastructure/security/security-headers';

/**
 * Cabeçalhos de segurança da api (CodeQL `js/insecure-helmet-configuration`).
 *
 * O teste que importa é o de baixo: roda o MESMO `helmet(helmetOptions())` do
 * `main.ts` sobre uma requisição de verdade e olha o cabeçalho que sai na
 * resposta. Afirmar só sobre o objeto de configuração não provaria nada —
 * `false` e um objeto de diretivas são os dois "configuração válida", e a
 * diferença entre eles só aparece na resposta HTTP.
 *
 * Sem Express aqui de propósito: ele não é dependência direta da api (entra
 * pelo `@nestjs/platform-express`), e o helmet é middleware de `node:http` puro
 * — só chama `res.setHeader`. Um listener de duas linhas exercita o mesmo
 * caminho sem lib nova, que é o que o CLAUDE.md pede.
 */
function appComHelmet() {
  const middleware = helmet(helmetOptions());
  return (req: IncomingMessage, res: ServerResponse) => {
    middleware(req, res, () => {
      res.setHeader('Content-Type', 'application/json');
      res.end('{"ok":true}');
    });
  };
}

describe('helmetOptions', () => {
  afterEach(() => {
    delete process.env.NODE_ENV;
  });

  it('em produção, o CSP nega tudo — api JSON não carrega sub-recurso nenhum', () => {
    process.env.NODE_ENV = 'production';
    expect(cspDirectives()).toEqual({
      'default-src': ["'none'"],
      'frame-ancestors': ["'none'"],
      'base-uri': ["'none'"],
      'form-action': ["'none'"],
    });
  });

  it('fora de produção afrouxa o necessário para o Swagger UI, e nada além', () => {
    const directives = cspDirectives();
    expect(directives['default-src']).toEqual(["'none'"]);
    expect(directives['script-src']).toContain("'self'");
    // `frame-ancestors` NÃO é afrouxado nem para o Swagger: emoldurar `/docs`
    // não é caso de uso de ninguém.
    expect(directives['frame-ancestors']).toEqual(["'none'"]);
  });

  it("'unsafe-inline' nunca aparece no perfil de produção", () => {
    process.env.NODE_ENV = 'production';
    const valores = Object.values(cspDirectives()).flat();
    expect(valores).not.toContain("'unsafe-inline'");
  });

  it('a web continua podendo consumir a resposta de outra origem', () => {
    expect(helmetOptions().crossOriginResourcePolicy).toEqual({
      policy: 'cross-origin',
    });
  });
});

describe('a resposta HTTP carrega os cabeçalhos', () => {
  afterEach(() => {
    delete process.env.NODE_ENV;
  });

  it('manda Content-Security-Policy em produção, com default-src none', async () => {
    process.env.NODE_ENV = 'production';
    const resposta = await request(appComHelmet()).get('/qualquer');

    const csp = resposta.headers['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('manda Content-Security-Policy também fora de produção', async () => {
    const resposta = await request(appComHelmet()).get('/qualquer');

    const csp = resposta.headers['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('manda Cross-Origin-Resource-Policy: cross-origin', async () => {
    const resposta = await request(appComHelmet()).get('/qualquer');
    expect(resposta.headers['cross-origin-resource-policy']).toBe(
      'cross-origin',
    );
  });

  it('os cabeçalhos default do helmet seguem de pé (nosseniff, no-referrer)', async () => {
    const resposta = await request(appComHelmet()).get('/qualquer');
    expect(resposta.headers['x-content-type-options']).toBe('nosniff');
    expect(resposta.headers['referrer-policy']).toBe('no-referrer');
  });
});
