import { Module } from '@nestjs/common';
import { ActionsUseCasesModule } from '../../../application/use-cases/actions/actions-use-cases.module';
import { ActionsController } from './actions.controller';
import { ProjectActionsController } from './project-actions.controller';
import { DecisionInboxController } from './decision-inbox.controller';
import { AgentAutonomyController } from './agent-autonomy.controller';

@Module({
  imports: [ActionsUseCasesModule],
  controllers: [
    ActionsController,
    ProjectActionsController,
    AgentAutonomyController,
    DecisionInboxController,
  ],
})
export class ActionsHttpModule {}
