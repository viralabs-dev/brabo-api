import { Module } from '@nestjs/common';
import { AgentsUseCasesModule } from '../../../application/use-cases/agents/agents-use-cases.module';
import { AgentsController } from './agents.controller';

@Module({
  imports: [AgentsUseCasesModule],
  controllers: [AgentsController],
})
export class AgentsHttpModule {}
