import type { Request } from 'express';
import type { User } from '../../../domain/iam/user.entity';
import type { Role } from '../../../domain/iam/role';

/**
 * O que os guards prometem aos controllers.
 *
 * `clientId` existia aqui até a Fase 7a: era o claim `azp` do Keycloak, e
 * servia para o `EngineServiceGuard` reconhecer o engine e para o
 * `RateLimitGuard` isentá-lo. Sem Keycloak não há `azp`, e os dois passaram a
 * decidir pelo `@ServiceRoute()`. Deixar o campo como `null` perpétuo seria
 * pior do que removê-lo: um campo de identidade que nunca vale nada é um
 * convite a alguém reintroduzi-lo numa checagem de autorização.
 */
export interface AuthenticatedRequest extends Request {
  user: User;
  effectiveRole?: Role;
}
