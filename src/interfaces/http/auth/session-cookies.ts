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
 * `Path=/auth` limita o alcance do REFRESH: ele não acompanha nenhuma outra
 * rota da api, então nem o log de acesso nem um proxy no meio o veem no
 * tráfego normal.
 */
const PATH_REFRESH = '/auth';

/**
 * O CSRF precisa de `Path=/`, e não é descuido — é o que faz o double-submit
 * funcionar.
 *
 * `document.cookie` só expõe cookies cujo path é prefixo do path da PÁGINA. Com
 * `/auth`, a web (que vive em `/`, `/login`, `/projects/...`) nunca enxergava
 * este cookie: `csrf()` devolvia string vazia, o `X-CSRF-Token` ia vazio e todo
 * `POST /auth/refresh` morria em 403. Na prática o refresh nunca funcionou no
 * browser — a sessão caía no primeiro reload ou quando o access de 15 minutos
 * expirava, e o sintoma (voltar para o login) não parecia um bug de cookie.
 *
 * Alargar o path NÃO enfraquece nada: este cookie não é credencial, é um valor
 * aleatório que só serve para ser ecoado num cabeçalho e comparado — o próprio
 * comentário abaixo diz que ele não é segredo. Quem carrega a sessão é o
 * refresh, e esse continua trancado em `/auth` e `httpOnly`.
 */
const PATH_CSRF = '/';

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
    path: PATH_REFRESH,
    maxAge: ttlMs,
  });

  /**
   * Apaga o CSRF legado, que nasceu com `Path=/auth`.
   *
   * Sem isto, quem já tinha sessão fica com DOIS `brabo_csrf` no browser — o
   * velho em `/auth` e o novo em `/` — e o browser manda os dois para
   * `/auth/refresh`. Pela RFC 6265 o de path mais específico vem primeiro,
   * então o `cookie-parser` lê o VELHO enquanto o JS (que só enxerga o de `/`)
   * ecoa o NOVO: os dois valores existem, não batem, e o refresh morre em
   * "Token CSRF não confere" — um 403 pior que o anterior, porque agora parece
   * ataque em vez de configuração.
   *
   * O login precisa curar isso sozinho: ninguém vai pedir ao usuário que limpe
   * cookie. Pode sair quando não houver mais sessão emitida antes desta versão
   * — o TTL da família de refresh é de 30 dias.
   */
  res.clearCookie(COOKIE_CSRF, {
    httpOnly: false,
    sameSite: 'strict',
    secure: producao(),
    path: PATH_REFRESH,
  });

  // Legível por JS de propósito: é a metade que a web precisa ecoar no
  // cabeçalho. Ele não é segredo — é prova de mesma origem.
  res.cookie(COOKIE_CSRF, randomBytes(32).toString('base64url'), {
    httpOnly: false,
    sameSite: 'strict',
    secure: producao(),
    path: PATH_CSRF,
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
  };
  res.clearCookie(COOKIE_REFRESH, { ...opcoes, path: PATH_REFRESH });
  // Cada um com o SEU path: apagar o csrf com `/auth` deixaria vivo o cookie
  // que foi gravado em `/`, e o logout viraria mentira justamente no cookie
  // que o JS enxerga.
  res.clearCookie(COOKIE_CSRF, {
    ...opcoes,
    httpOnly: false,
    path: PATH_CSRF,
  });
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
