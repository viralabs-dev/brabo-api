import { Module } from '@nestjs/common';
import { ContainersUseCasesModule } from '../../../application/use-cases/containers/containers-use-cases.module';
import { ContainersController } from './containers.controller';

@Module({
  imports: [ContainersUseCasesModule],
  controllers: [ContainersController],
})
export class ContainersHttpModule {}
