import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { WorkspacesController } from './workspaces.controller';
import { ProjectsController } from './projects.controller';
import { UserPreferencesController } from './user-preferences.controller';
import { SessionResponseLanguageController } from './session-response-language.controller';
import { IamUseCasesModule } from '../../../application/use-cases/iam/iam-use-cases.module';
import { SessionsUseCasesModule } from '../../../application/use-cases/sessions/sessions-use-cases.module';
import { OferecerAutomacaoUseCase } from '../../../application/use-cases/automacao/oferecer-automacao.use-case';
import { ContainerBrokerHttpClientModule } from '../../../infrastructure/http-clients/container-broker-http-client.module';

@Module({
  // `ContainerBrokerHttpClientModule` só pela pergunta `configurado()` de
  // `projects-base` (ADR 0161, RN-573) — nenhuma rota deste módulo fala com o
  // broker.
  // `SessionsUseCasesModule` + `OferecerAutomacaoUseCase`: a resposta à oferta
  // (AT-998) grava o evento `automacao.aceita`/`recusada` na sessão.
  imports: [
    IamUseCasesModule,
    ContainerBrokerHttpClientModule,
    SessionsUseCasesModule,
  ],
  controllers: [
    WorkspacesController,
    ProjectsController,
    UserPreferencesController,
    SessionResponseLanguageController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: RolesGuard },
    OferecerAutomacaoUseCase,
  ],
})
export class IamHttpModule {}
