import { Module } from '@nestjs/common';
import { AgentsUseCasesModule } from '../../../application/use-cases/agents/agents-use-cases.module';
import { AgentsController } from './agents.controller';
import { AgentCatalogController } from './agent-catalog.controller';

@Module({
  imports: [AgentsUseCasesModule],
  controllers: [AgentsController, AgentCatalogController],
})
export class AgentsHttpModule {}
