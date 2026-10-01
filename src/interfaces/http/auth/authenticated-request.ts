import type { Request } from 'express';
import type { User } from '../../../domain/iam/user.entity';
import type { Role } from '../../../domain/iam/role';
import type { CredencialDeDispositivo } from '../../../application/ports/api-to-engine-client.port';

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
  /**
   * QUAL credencial de dispositivo autenticou esta requisição — só o
   * `PatAuthGuard` a preenche, e só nas rotas `@RequirePatAuth()`. Viaja até a
   * linha do ticket do runner para a revogação mirar a CHAVE e não o par
   * `{projeto, usuário}` (ADR 0201, RN-685).
   */
  credencialDeDispositivo?: CredencialDeDispositivo;
}
