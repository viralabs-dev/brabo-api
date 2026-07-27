import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthController } from './auth.controller';
import { JwksController } from './jwks.controller';
import { TokenVerifier } from '../../../application/ports/token-verifier.port';
import { FirstPartyTokenVerifier } from '../../../infrastructure/security/first-party-token-verifier';
import { IamUseCasesModule } from '../../../application/use-cases/iam/iam-use-cases.module';
import { AuthUseCasesModule } from '../../../application/use-cases/auth/auth-use-cases.module';

/**
 * O emissor da api (Fase 7a — o corte).
 *
 * A 7.1 construiu o auth em paralelo e prometeu que a troca seria uma linha.
 * Foi: o `useClass` do `TokenVerifier` saiu do `KeycloakTokenVerifier` e
 * passou ao `FirstPartyTokenVerifier`. Nenhum controller mudou, e o RBAC da
 * Fase 1 não foi tocado — nenhuma decisão de papel lê claim de token, só
 * `request.user.id`, que continua sendo a mesma linha do banco.
 *
 * Não houve período de coexistência. Aceitar dois emissores exigiria manter
 * dois caminhos vivos e testados por prazo indefinido; o corte custa um
 * logout coletivo anunciado, uma vez. Ver ADR 0032.
 */
@Module({
  imports: [IamUseCasesModule, AuthUseCasesModule],
  controllers: [AuthController, JwksController],
  providers: [
    { provide: TokenVerifier, useClass: FirstPartyTokenVerifier },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AuthHttpModule {}
