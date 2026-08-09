import { Module } from '@nestjs/common';
import { LlmUseCasesModule } from '../../../application/use-cases/llm/llm-use-cases.module';
// O teste de credencial atende LLM e git na mesma rota (mesma tabela) —
// por isso vem de um módulo próprio, e não do de LLM. Ver ADR 0050.
import { CredentialsUseCasesModule } from '../../../application/use-cases/credentials/credentials-use-cases.module';
import { ModelsController } from './models.controller';
import { ModelBindingsController } from './model-bindings.controller';
import { CredentialsController } from './credentials.controller';
import { BudgetsController } from './budgets.controller';
import { ChatController } from './chat.controller';
import { SpendController } from './spend.controller';

@Module({
  imports: [LlmUseCasesModule, CredentialsUseCasesModule],
  controllers: [
    ModelsController,
    ModelBindingsController,
    CredentialsController,
    BudgetsController,
    ChatController,
    SpendController,
  ],
})
export class LlmHttpModule {}
