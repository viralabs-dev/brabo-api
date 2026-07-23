import { Module } from '@nestjs/common';
import { LlmUseCasesModule } from '../../../application/use-cases/llm/llm-use-cases.module';
import { ModelsController } from './models.controller';
import { ModelBindingsController } from './model-bindings.controller';
import { CredentialsController } from './credentials.controller';
import { BudgetsController } from './budgets.controller';
import { ChatController } from './chat.controller';

@Module({
  imports: [LlmUseCasesModule],
  controllers: [
    ModelsController,
    ModelBindingsController,
    CredentialsController,
    BudgetsController,
    ChatController,
  ],
})
export class LlmHttpModule {}
