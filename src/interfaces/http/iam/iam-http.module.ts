import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { WorkspacesController } from './workspaces.controller';
import { ProjectsController } from './projects.controller';
import { UserPreferencesController } from './user-preferences.controller';
import { IamUseCasesModule } from '../../../application/use-cases/iam/iam-use-cases.module';
import { ContainerBrokerHttpClientModule } from '../../../infrastructure/http-clients/container-broker-http-client.module';

@Module({
  // `ContainerBrokerHttpClientModule` só pela pergunta `configurado()` de
  // `projects-base` (ADR 0161, RN-573) — nenhuma rota deste módulo fala com o
  // broker.
  imports: [IamUseCasesModule, ContainerBrokerHttpClientModule],
  controllers: [
    WorkspacesController,
    ProjectsController,
    UserPreferencesController,
  ],
  providers: [{ provide: APP_GUARD, useClass: RolesGuard }],
})
export class IamHttpModule {}
