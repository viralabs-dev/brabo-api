import { Module } from '@nestjs/common';
import { SessionsUseCasesModule } from '../../../application/use-cases/sessions/sessions-use-cases.module';
import { LlmUseCasesModule } from '../../../application/use-cases/llm/llm-use-cases.module';
import { ActionsUseCasesModule } from '../../../application/use-cases/actions/actions-use-cases.module';
import { InternalSessionsController } from './internal-sessions.controller';

@Module({
  imports: [SessionsUseCasesModule, LlmUseCasesModule, ActionsUseCasesModule],
  controllers: [InternalSessionsController],
})
export class InternalHttpModule {}
