import { Module } from '@nestjs/common';
import { ContainersUseCasesModule } from '../../../application/use-cases/containers/containers-use-cases.module';
import { ContainersController } from './containers.controller';
import { ContainersOverviewController } from './containers-overview.controller';

@Module({
  imports: [ContainersUseCasesModule],
  controllers: [ContainersController, ContainersOverviewController],
})
export class ContainersHttpModule {}
