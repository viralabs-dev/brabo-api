import { Module } from '@nestjs/common';
import { RunnerUseCasesModule } from '../../../application/use-cases/runner/runner-use-cases.module';
import { AuthUseCasesModule } from '../../../application/use-cases/auth/auth-use-cases.module';
import { IamUseCasesModule } from '../../../application/use-cases/iam/iam-use-cases.module';
import { RunnerTicketsController } from './runner-tickets.controller';
import { PersonalAccessTokensController } from './personal-access-tokens.controller';
import { PatAuthGuard } from '../auth/pat-auth.guard';

@Module({
  // AuthUseCasesModule entrou pelo PAT (ADR 0105) — Issue/List/Revoke
  // PersonalAccessTokenUseCase moram lá (TokenFactory já é de lá), e
  // PersonalAccessTokensController é interface do runner que os consome.
  // IamUseCasesModule entrou pela RN-439: `PatAuthGuard` passou a aplicar
  // `@RequireRole` ele mesmo (ver o docblock do guard) e precisa de
  // `ResolveEffectiveRoleUseCase`, que mora lá.
  imports: [RunnerUseCasesModule, AuthUseCasesModule, IamUseCasesModule],
  controllers: [RunnerTicketsController, PersonalAccessTokensController],
  // PatAuthGuard entra em `providers` (não `APP_GUARD`) porque só a rota
  // `runner-ticket` o usa (`@UseGuards(PatAuthGuard)`) — diferente de
  // JwtAuthGuard/RolesGuard, que são globais. Tem dependências no
  // construtor (PersonalAccessTokenRepository/UserRepository/Reflector/
  // ResolveEffectiveRoleUseCase), então precisa estar registrado aqui pro
  // Nest resolver a injeção.
  providers: [PatAuthGuard],
})
export class RunnerHttpModule {}
