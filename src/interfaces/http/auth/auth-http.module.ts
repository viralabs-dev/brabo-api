import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TokenVerifier } from '../../../application/ports/token-verifier.port';
import { KeycloakTokenVerifier } from '../../../infrastructure/http-clients/keycloak-token-verifier';
import { IamUseCasesModule } from '../../../application/use-cases/iam/iam-use-cases.module';

@Module({
  imports: [IamUseCasesModule],
  providers: [
    { provide: TokenVerifier, useClass: KeycloakTokenVerifier },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AuthHttpModule {}
