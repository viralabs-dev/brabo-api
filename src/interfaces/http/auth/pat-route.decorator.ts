import { SetMetadata } from '@nestjs/common';

export const IS_PAT_ROUTE_KEY = 'isPatRoute';

/**
 * Marca a rota como autenticável por credencial de DISPOSITIVO — Personal
 * Access Token OU chave de dispositivo (Ed25519, ver `PatAuthGuard`) — e
 * NUNCA por JWT de sessão (login), mesmo padrão estrutural de
 * `@ServiceRoute()`/`IS_SERVICE_ROUTE_KEY` pro tráfego serviço→serviço.
 *
 * ## Por que não dá pra aceitar o JWT de SESSÃO nesta rota
 *
 * Nenhum lugar do `apps/web` chama esta rota autenticado por sessão hoje —
 * só o CLI do runner (PAT ou chave de dispositivo). Aceitar o JWT de login
 * também abriria um segundo caminho de auth sem chamador real pra
 * justificar, e cada caminho extra é superfície extra de manutenção.
 * `PatAuthGuard` recusa (401) qualquer bearer que não comece com `brb_` nem
 * tenha a forma de um JWT de chave de dispositivo — o JWT de SESSÃO cai
 * nessa segunda forma sintaticamente, mas nunca verifica: a chave pública
 * que ele checa vem de `runner_device_keys`, nunca do emissor de sessão.
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
