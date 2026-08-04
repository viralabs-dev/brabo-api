import { describe, it, expect } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  CABECALHO_CSRF,
  COOKIE_CSRF,
  COOKIE_REFRESH,
  definirCookiesDeSessao,
  exigirCsrf,
  limparCookiesDeSessao,
  refreshDoCookie,
} from '../../src/interfaces/http/auth/session-cookies';

/**
 * O contrato do cookie de sessão (Fase 7a, item 5).
 *
 * As flags aqui não são preferência: cada uma fecha um ataque, e uma que se
 * perca num refactor não quebra teste nenhum de fluxo — o login continuaria
 * funcionando com o cookie legível por JavaScript. É por isso que elas são
 * afirmadas uma a uma.
 */

interface CookieGravado {
  nome: string;
  valor: string;
  opcoes: Record<string, unknown>;
}

function resposta() {
  const gravados: CookieGravado[] = [];
  const limpos: CookieGravado[] = [];

  const res = {
    cookie: (nome: string, valor: string, opcoes: Record<string, unknown>) => {
      gravados.push({ nome, valor, opcoes });
    },
    clearCookie: (nome: string, opcoes: Record<string, unknown>) => {
      limpos.push({ nome, valor: '', opcoes });
    },
  } as unknown as Response;

  return { res, gravados, limpos };
}

function requisicao(opcoes: {
  cookies?: Record<string, string>;
  csrfNoCabecalho?: string;
}): Request {
  return {
    cookies: opcoes.cookies,
    headers: opcoes.csrfNoCabecalho
      ? { [CABECALHO_CSRF]: opcoes.csrfNoCabecalho }
      : {},
  } as unknown as Request;
}

describe('cookies de sessão', () => {
  it('o refresh é httpOnly — é a proteção inteira contra XSS', () => {
    const { res, gravados } = resposta();

    definirCookiesDeSessao(res, 'refresh-abc', 1000);

    const refresh = gravados.find((c) => c.nome === COOKIE_REFRESH)!;
    expect(refresh.valor).toBe('refresh-abc');
    expect(refresh.opcoes.httpOnly).toBe(true);
  });

  it('o refresh é SameSite=Strict e escopado em /auth', () => {
    const { res, gravados } = resposta();

    definirCookiesDeSessao(res, 'refresh-abc', 1000);

    const refresh = gravados.find((c) => c.nome === COOKIE_REFRESH)!;
    expect(refresh.opcoes.sameSite).toBe('strict');
    // Sem o path, o refresh acompanharia TODA requisição à api — inclusive as
    // que não têm nada a ver com sessão.
    expect(refresh.opcoes.path).toBe('/auth');
  });

  it('o cookie de CSRF é legível por JS — é o par do double-submit', () => {
    const { res, gravados } = resposta();

    definirCookiesDeSessao(res, 'refresh-abc', 1000);

    const csrf = gravados.find((c) => c.nome === COOKIE_CSRF)!;
    expect(csrf.opcoes.httpOnly).toBe(false);
    expect(csrf.valor).toBeTruthy();
  });

  /**
   * `httpOnly: false` sozinho NÃO torna um cookie legível: `document.cookie` só
   * expõe os cookies cujo path é prefixo do path da PÁGINA. Este cookie nasceu
   * com `/auth` junto do refresh, e a web — que vive em `/`, `/login`,
   * `/projects/...` — nunca o enxergou. O `X-CSRF-Token` ia vazio e TODO
   * refresh morria em 403: a sessão caía no primeiro reload, e o sintoma
   * (voltar para o login) não parecia bug de cookie.
   *
   * Este teste existia afirmando o contrário — cobrava `/auth` para os dois
   * cookies —, que é como o defeito atravessou a suite inteira.
   */
  it('o CSRF vale para o site TODO — senão o JS da web não o alcança', () => {
    const { res, gravados } = resposta();

    definirCookiesDeSessao(res, 'refresh-abc', 1000);

    expect(gravados.find((c) => c.nome === COOKIE_CSRF)!.opcoes.path).toBe('/');
    // E o refresh continua trancado: é ele que carrega a sessão.
    expect(gravados.find((c) => c.nome === COOKIE_REFRESH)!.opcoes.path).toBe(
      '/auth',
    );
  });

  it('cada login gera um CSRF diferente', () => {
    const a = resposta();
    const b = resposta();

    definirCookiesDeSessao(a.res, 'r', 1000);
    definirCookiesDeSessao(b.res, 'r', 1000);

    expect(a.gravados.find((c) => c.nome === COOKIE_CSRF)!.valor).not.toBe(
      b.gravados.find((c) => c.nome === COOKIE_CSRF)!.valor,
    );
  });

  it('Secure só em produção — em dev o http local precisa funcionar', () => {
    const antes = process.env.NODE_ENV;

    process.env.NODE_ENV = 'production';
    const prod = resposta();
    definirCookiesDeSessao(prod.res, 'r', 1000);

    process.env.NODE_ENV = 'development';
    const dev = resposta();
    definirCookiesDeSessao(dev.res, 'r', 1000);

    process.env.NODE_ENV = antes;

    expect(
      prod.gravados.find((c) => c.nome === COOKIE_REFRESH)!.opcoes.secure,
    ).toBe(true);
    expect(
      dev.gravados.find((c) => c.nome === COOKIE_REFRESH)!.opcoes.secure,
    ).toBe(false);
  });

  it('a limpeza repete path e flags — senão o cookie sobrevive ao logout', () => {
    // O browser só remove um cookie quando os atributos batem. Um
    // `clearCookie` sem `path` não apaga nada, e o logout vira mentira.
    const { res, limpos } = resposta();

    limparCookiesDeSessao(res);

    expect(limpos.map((c) => c.nome).sort()).toEqual([
      COOKIE_CSRF,
      COOKIE_REFRESH,
    ]);
    for (const c of limpos) {
      expect(c.opcoes.sameSite).toBe('strict');
    }
    // Cada um com o SEU path — apagar o csrf com `/auth` não removeria o
    // cookie que foi gravado em `/`.
    const porNome = Object.fromEntries(limpos.map((c) => [c.nome, c]));
    expect(porNome[COOKIE_REFRESH].opcoes.path).toBe('/auth');
    expect(porNome[COOKIE_CSRF].opcoes.path).toBe('/');
  });

  /**
   * A migração que o próprio conserto criou.
   *
   * Quem já tinha sessão ficava com DOIS `brabo_csrf` — o velho em `/auth` e o
   * novo em `/`. O browser manda os dois para `/auth/refresh`, e pela RFC 6265
   * o de path mais específico vem primeiro: a api lia o velho enquanto o JS
   * ecoava o novo. Os dois existiam, não batiam, e o 403 passava a dizer
   * "Token CSRF não confere" — pior que o anterior, porque parece ataque em vez
   * de configuração. Visto em execução, depois do conserto.
   */
  it('o login apaga o CSRF legado de /auth — senão os dois convivem', () => {
    const { res, limpos } = resposta();

    definirCookiesDeSessao(res, 'r', 1000);

    const legado = limpos.find(
      (c) => c.nome === COOKIE_CSRF && c.opcoes.path === '/auth',
    );
    expect(legado, 'o csrf de /auth precisa ser apagado no login').toBeDefined();
  });

  /**
   * A trava que fecha o ciclo: o path com que o cookie é GRAVADO tem de ser o
   * mesmo com que ele é APAGADO, cookie a cookie. Foi a divergência entre os
   * dois lados que deixou o defeito passar, e comparar os dois conjuntos é o
   * que impede a próxima.
   */
  it('grava e apaga com os MESMOS paths, cookie a cookie', () => {
    const { res, gravados, limpos } = resposta();

    definirCookiesDeSessao(res, 'r', 1000);
    limparCookiesDeSessao(res);

    const pathDe = (lista: typeof gravados) =>
      Object.fromEntries(lista.map((c) => [c.nome, c.opcoes.path]));

    expect(pathDe(limpos)).toEqual(pathDe(gravados));
  });

  it('lê o refresh do cookie, e devolve null quando não há', () => {
    expect(
      refreshDoCookie(requisicao({ cookies: { [COOKIE_REFRESH]: 'abc' } })),
    ).toBe('abc');
    expect(refreshDoCookie(requisicao({}))).toBeNull();
  });
});

describe('CSRF por double-submit', () => {
  it('caminho feliz: cookie e cabeçalho iguais passam', () => {
    expect(() =>
      exigirCsrf(
        requisicao({
          cookies: { [COOKIE_CSRF]: 'token-csrf' },
          csrfNoCabecalho: 'token-csrf',
        }),
      ),
    ).not.toThrow();
  });

  it('recusa quando o cabeçalho não bate com o cookie', () => {
    expect(() =>
      exigirCsrf(
        requisicao({
          cookies: { [COOKIE_CSRF]: 'token-csrf' },
          csrfNoCabecalho: 'outro-token',
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('recusa sem cabeçalho — é o caso do CSRF de verdade', () => {
    // Um site hostil consegue fazer o browser MANDAR o cookie, mas não
    // consegue LER o valor para montar o cabeçalho: o CORS impede.
    expect(() =>
      exigirCsrf(requisicao({ cookies: { [COOKIE_CSRF]: 'token-csrf' } })),
    ).toThrow(ForbiddenException);
  });

  it('recusa sem cookie', () => {
    expect(() => exigirCsrf(requisicao({ csrfNoCabecalho: 'x' }))).toThrow(
      ForbiddenException,
    );
  });

  it('recusa quando os dois faltam', () => {
    expect(() => exigirCsrf(requisicao({}))).toThrow(ForbiddenException);
  });

  it('falha com 403, não 401', () => {
    // 401 faria o cliente tentar renovar a sessão e entrar em laço: a
    // credencial está boa, quem está errada é a requisição.
    try {
      exigirCsrf(requisicao({}));
      expect.unreachable('deveria ter lançado');
    } catch (erro) {
      expect((erro as ForbiddenException).getStatus()).toBe(403);
    }
  });
});
