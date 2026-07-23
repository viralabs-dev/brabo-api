import { Module } from '@nestjs/common';
import { ActionsUseCasesModule } from '../../../application/use-cases/actions/actions-use-cases.module';
import { ActionsController } from './actions.controller';
import { AgentAutonomyController } from './agent-autonomy.controller';

@Module({
  imports: [ActionsUseCasesModule],
  controllers: [ActionsController, AgentAutonomyController],
})
export class ActionsHttpModule {}
