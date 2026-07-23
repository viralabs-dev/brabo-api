import { Module } from '@nestjs/common';
import { ActionsUseCasesModule } from '../../../application/use-cases/actions/actions-use-cases.module';
import { ActionsController } from './actions.controller';

@Module({
  imports: [ActionsUseCasesModule],
  controllers: [ActionsController],
})
export class ActionsHttpModule {}
