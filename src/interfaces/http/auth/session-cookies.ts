import { randomBytes } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { comparaEmTempoConstante } from '../../../infrastructure/security/auth-key-material';

/**
 * A sessão da web em cookie (Fase 7a, item 5).
 *
 * ## Por que o refresh sai do corpo da resposta
 *
 * Na 7.1 o `/auth/login` devolvia `refreshToken` no JSON, e a web teria que
 * guardá-lo em algum lugar que o JavaScript alcança — `localStorage` na
 * prática. Um XSS ali leva a sessão LONGA (30 dias de família), não os 15
 * minutos do access token.
 *
 * Com `httpOnly`, o JS não lê o refresh nem para mandar de volta: o browser o
 * anexa sozinho em `/auth/*`. Devolvê-lo TAMBÉM no corpo anularia a proteção
 * inteira — bastaria o XSS ler a resposta do login. Por isso o corpo passa a
 * ter só `accessToken` e `expiresIn`.
 *
 * O access token continua em memória JS e vai no `Authorization: Bearer`. Ele
 * é curto por desenho, e mantê-lo fora do cookie evita ter que exigir CSRF em
 * TODA rota autenticada — só nas de auth.
 *
 * ## Por que CSRF mesmo com SameSite=Strict
 *
 * `SameSite=Strict` já impede o browser de anexar o cookie numa requisição
 * partindo de outro site, o que sozinho fecha o CSRF nestas rotas. O
 * double-submit é a segunda camada, e ela paga por três coisas que o
 * `SameSite` não cobre: browser antigo que ignora o atributo, um subdomínio
 * comprometido (que é "same site" para efeito do cookie), e o dia em que
 * alguém precisar afrouxar para `Lax` por causa de um fluxo de redirect.
 *
 * O par é um cookie legível por JS mais o cabeçalho `X-CSRF-Token`: quem está
 * em outra origem não consegue LER o cookie (o CORS impede), então não
 * consegue montar o cabeçalho.
 */
export const COOKIE_REFRESH = 'brabo_refresh';
export const COOKIE_CSRF = 'brabo_csrf';
export const CABECALHO_CSRF = 'x-csrf-token';

/**
 * `Path=/auth` limita o alcance: o cookie não acompanha nenhuma outra rota da
 * api, então nem o log de acesso nem um proxy no meio veem o refresh no
 * tráfego normal.
 */
const PATH = '/auth';

function producao(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function definirCookiesDeSessao(
  res: Response,
  refreshToken: string,
  ttlMs: number,
): void {
  res.cookie(COOKIE_REFRESH, refreshToken, {
    httpOnly: true,
    sameSite: 'strict',
    secure: producao(),
    path: PATH,
    maxAge: ttlMs,
  });

  // Legível por JS de propósito: é a metade que a web precisa ecoar no
  // cabeçalho. Ele não é segredo — é prova de mesma origem.
  res.cookie(COOKIE_CSRF, randomBytes(32).toString('base64url'), {
    httpOnly: false,
    sameSite: 'strict',
    secure: producao(),
    path: PATH,
    maxAge: ttlMs,
  });
}

export function limparCookiesDeSessao(res: Response): void {
  // Mesmos atributos do `cookie()`: o browser só remove quando path e flags
  // batem. Um `clearCookie` sem `path` deixa o cookie vivo e o logout vira
  // mentira.
  const opcoes = {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: producao(),
    path: PATH,
  };
  res.clearCookie(COOKIE_REFRESH, opcoes);
  res.clearCookie(COOKIE_CSRF, { ...opcoes, httpOnly: false });
}

/**
 * Os cookies já parseados, com tipo.
 *
 * `@types/cookie-parser` declara `req.cookies` como `any`, e `any` se espalha:
 * cada leitura viraria um valor sem checagem passando adiante. A conversão
 * acontece UMA vez aqui, via `unknown`, e o resto do arquivo trabalha com
 * `string | undefined` de verdade.
 */
function cookiesDe(req: Request): Record<string, string | undefined> {
  const bruto = (req as unknown as { cookies?: unknown }).cookies;
  return (bruto ?? {}) as Record<string, string | undefined>;
}

export function refreshDoCookie(req: Request): string | null {
  return cookiesDe(req)[COOKIE_REFRESH] ?? null;
}

/**
 * Confere o double-submit. Lança 403 quando não bate.
 *
 * 403 e não 401 de propósito: 401 diz "sua credencial não serve" e faria o
 * cliente tentar renovar a sessão, entrando em laço. 403 diz "a requisição
 * está malformada", que é o que de fato aconteceu.
 */
export function exigirCsrf(req: Request): void {
  const doCookie = cookiesDe(req)[COOKIE_CSRF];
  const doCabecalho = req.headers[CABECALHO_CSRF];
  const apresentado = Array.isArray(doCabecalho) ? doCabecalho[0] : doCabecalho;

  if (!doCookie || !apresentado) {
    throw new ForbiddenException('Requisição sem token CSRF.');
  }
  if (!comparaEmTempoConstante(doCookie, apresentado)) {
    throw new ForbiddenException('Token CSRF não confere.');
  }
}
