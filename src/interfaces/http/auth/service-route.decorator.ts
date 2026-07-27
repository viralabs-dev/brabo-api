import { SetMetadata } from '@nestjs/common';

export const IS_SERVICE_ROUTE_KEY = 'isServiceRoute';

/**
 * Marca a rota como tráfego SERVIÇO→SERVIÇO, não de usuário (Fase 7a, item 4).
 *
 * ## O que ela faz
 *
 * O `JwtAuthGuard` não exige Bearer de usuário, e o `RateLimitGuard` isenta.
 * Quem autentica é o `EngineServiceGuard`, com o segredo compartilhado.
 *
 * ## Por que não dá para reusar `@Public()`
 *
 * `@Public()` significa "qualquer um entra" e é o que classifica a rota como
 * `public` no `route-surface.spec.ts`. Estas rotas são o oposto: ninguém entra
 * sem o segredo. Reusar o decorator misturaria as 26 rotas internas com as 12
 * públicas na revisão de superfície — exatamente a distinção que aquele teste
 * existe para manter visível.
 *
 * ## Por que o rate limit precisa do METADADO, e não do guard
 *
 * `RateLimitGuard` é `APP_GUARD` e roda ANTES de qualquer guard de controller,
 * então quando ele decide o `EngineServiceGuard` ainda não rodou e não há nada
 * no request que identifique o chamador. Antes da Fase 7a a isenção vinha do
 * `clientId` que o guard de JWT populava; sem Keycloak não há `azp`, e o
 * metadado é o único sinal disponível cedo o bastante.
 */
export const ServiceRoute = () => SetMetadata(IS_SERVICE_ROUTE_KEY, true);
