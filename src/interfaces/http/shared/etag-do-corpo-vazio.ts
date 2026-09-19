import type { NextFunction, Request, Response } from 'express';

/**
 * Validador (`ETag`) também para a resposta de corpo VAZIO — AT-093, RN-579.
 *
 * ## O defeito, medido
 *
 * Nos logs da instalação (v6.1.0, 14/09), `GET .../sessions/:id/budget`
 * voltou 304 em 0% de 483 chamadas e `GET .../execution/session` em 22% de
 * 631, contra 93–99% das outras rotas em poll. Não era campo volátil no
 * corpo: é que o corpo era `null`. Handler do Nest que devolve `null` sai por
 * `ExpressAdapter.reply` → `response.send()` SEM argumento, e o `res.send` do
 * Express só gera `ETag` quando há corpo (`len !== undefined`). Sem `ETag` o
 * navegador não tem o que mandar em `If-None-Match`, e `req.fresh` nunca é
 * verdadeiro — o 304 é impossível por construção. "Sessão sem orçamento" e
 * "projeto sem execução ativa" são o estado NORMAL dessas duas rotas, e os 22%
 * são exatamente o tempo em que havia uma execução ativa (corpo não-nulo).
 *
 * ## A correção, na causa
 *
 * Quando `send` é chamado com corpo ausente (`undefined`/`null`), isto grava o
 * `ETag` do corpo vazio ANTES de o Express decidir a frescura — o mesmo
 * `etag fn` da aplicação, então o valor é o que o próprio Express calcularia
 * para `''`. O corpo que sai continua byte a byte o mesmo (vazio, 200), então
 * nenhum consumidor muda: a web já lê corpo vazio como `null`
 * (`api-client.ts`) e o engine não passa por aqui de outro jeito.
 *
 * Por que no `send` e não num interceptor do Nest: o interceptor vê o VALOR
 * devolvido pelo handler, não o que vai ao fio. Um handler com `@Res()` devolve
 * `undefined` e escreve o corpo depois — o interceptor gravaria o `ETag` do
 * vazio num corpo que não é vazio, e o Express, vendo `ETag` já posto, não
 * recalcularia: 304 ERRADO. Aqui a decisão é tomada sobre o que efetivamente
 * sai, então o `ETag` é sempre o do corpo enviado.
 *
 * O que isto NÃO faz, e é bom estar escrito: 304 não reduz o número de
 * requisições. O `RateLimitGuard` conta a requisição antes do handler, com ou
 * sem 304. O que cai é banda e trabalho de serialização; o que cai o NÚMERO é
 * a web pollar menos (ver `apps/web/src/lib/canal-vivo.ts`).
 */
export function etagDoCorpoVazio() {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const sendOriginal = res.send.bind(res) as (corpo?: unknown) => Response;
    res.send = function sendComEtagDoVazio(corpo?: unknown): Response {
      if ((corpo === undefined || corpo === null) && !res.get('ETag')) {
        const gerar = res.app?.get('etag fn') as
          | ((corpo: string, codificacao: string) => string | undefined)
          | undefined;
        const etag =
          typeof gerar === 'function' ? gerar('', 'utf8') : undefined;
        if (etag) res.set('ETag', etag);
      }
      return sendOriginal(corpo);
    } as Response['send'];
    next();
  };
}
