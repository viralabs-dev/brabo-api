import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthController } from './auth.controller';
import { JwksController } from './jwks.controller';
import { TokenVerifier } from '../../../application/ports/token-verifier.port';
import { KeycloakTokenVerifier } from '../../../infrastructure/http-clients/keycloak-token-verifier';
import { IamUseCasesModule } from '../../../application/use-cases/iam/iam-use-cases.module';
import { AuthUseCasesModule } from '../../../application/use-cases/auth/auth-use-cases.module';

/**
 * Os dois emissores convivem nesta fase (Fase 7a).
 *
 * O `JwtAuthGuard` global continua ligado ao `KeycloakTokenVerifier`, intocado:
 * todo o resto da api depende do `request.user` que ele popula, e trocar o
 * emissor junto com a construção do auth novo não deixaria nenhum estado
 * intermediário testável.
 *
 * A troca da 7.2 é literalmente uma linha — `useClass` do `TokenVerifier`
 * apontando para uma implementação que valide o token emitido pelo
 * `Ed25519AccessTokenIssuer`. Nenhum controller muda, e o RBAC da Fase 1 não é
 * tocado.
 */
@Module({
  imports: [IamUseCasesModule, AuthUseCasesModule],
  controllers: [AuthController, JwksController],
  providers: [
    { provide: TokenVerifier, useClass: KeycloakTokenVerifier },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AuthHttpModule {}
