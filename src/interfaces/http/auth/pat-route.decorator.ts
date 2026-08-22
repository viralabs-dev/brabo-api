import { SetMetadata } from '@nestjs/common';

export const IS_PAT_ROUTE_KEY = 'isPatRoute';

/**
 * Marca a rota como autenticável SÓ por Personal Access Token (ADR 0105,
 * RN-424) — nunca por JWT de sessão, mesmo padrão estrutural de
 * `@ServiceRoute()`/`IS_SERVICE_ROUTE_KEY` pro tráfego serviço→serviço.
 *
 * ## Por que não dá pra aceitar os dois (PAT OU JWT) na mesma rota
 *
 * Nenhum lugar do `apps/web` chama esta rota hoje — só o CLI do runner.
 * Aceitar JWT também abriria um segundo caminho de auth sem chamador real
 * pra justificar, e cada caminho extra é superfície extra de manutenção.
 * `PatAuthGuard` recusa (401) qualquer bearer que não comece com `brb_`.
 *
 * ## Por que não dá pra popular `request.user` a partir do prefixo dentro
 * do `JwtAuthGuard` global
 *
 * Faria QUALQUER rota aceitar PAT — uma vez que `request.user` está setado,
 * `RolesGuard`/`@RequireRole` autorizam esse PAT pra tudo que o papel real
 * do dono permite no resto da api. O escopo `runner:project:<id>` do PAT
 * viraria decorativo. O metadado torna "PAT funciona em rota nova" algo que
 * exige um decorator explícito, nunca um comportamento herdado por engano.
 */
export const RequirePatAuth = () => SetMetadata(IS_PAT_ROUTE_KEY, true);
