import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { WorkspacesController } from './workspaces.controller';
import { ProjectsController } from './projects.controller';
import { UserPreferencesController } from './user-preferences.controller';
import { IamUseCasesModule } from '../../../application/use-cases/iam/iam-use-cases.module';

@Module({
  imports: [IamUseCasesModule],
  controllers: [
    WorkspacesController,
    ProjectsController,
    UserPreferencesController,
  ],
  providers: [{ provide: APP_GUARD, useClass: RolesGuard }],
})
export class IamHttpModule {}
