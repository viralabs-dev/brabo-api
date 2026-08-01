import { Module } from '@nestjs/common';
import { LlmInfrastructureModule } from '../../../infrastructure/llm/llm-infrastructure.module';
import { ListModelsUseCase } from './list-models.use-case';
import { ListModelCatalogUseCase } from './list-model-catalog.use-case';
import { SetModelsActiveUseCase } from './set-models-active.use-case';
import { SyncModelCatalogUseCase } from './sync-model-catalog.use-case';
import { UpdateModelPricingUseCase } from './update-model-pricing.use-case';
import { ListModelPriceChangesUseCase } from './list-model-price-changes.use-case';
import { SetModelBindingUseCase } from './set-model-binding.use-case';
import { GetModelBindingUseCase } from './get-model-binding.use-case';
import { ResolveModelBindingUseCase } from './resolve-model-binding.use-case';
import { UpsertUserCredentialUseCase } from './upsert-user-credential.use-case';
import { ListUserCredentialsUseCase } from './list-user-credentials.use-case';
import { DeleteUserCredentialUseCase } from './delete-user-credential.use-case';
import { UpsertBudgetUseCase } from './upsert-budget.use-case';
import { GetBudgetUseCase } from './get-budget.use-case';
import { GetSessionTokenUsageUseCase } from './get-session-token-usage.use-case';
import { CheckBudgetGateUseCase } from './check-budget-gate.use-case';
import { RecordLlmUsageUseCase } from './record-llm-usage.use-case';
import { SendChatMessageUseCase } from './send-chat-message.use-case';
import { RunLlmTurnUseCase } from './run-llm-turn.use-case';
import { StreamLlmTurnUseCase } from './stream-llm-turn.use-case';

const USE_CASES = [
  ListModelsUseCase,
  ListModelCatalogUseCase,
  SetModelsActiveUseCase,
  SyncModelCatalogUseCase,
  UpdateModelPricingUseCase,
  ListModelPriceChangesUseCase,
  SetModelBindingUseCase,
  GetModelBindingUseCase,
  ResolveModelBindingUseCase,
  UpsertUserCredentialUseCase,
  ListUserCredentialsUseCase,
  DeleteUserCredentialUseCase,
  UpsertBudgetUseCase,
  GetBudgetUseCase,
  GetSessionTokenUsageUseCase,
  CheckBudgetGateUseCase,
  RecordLlmUsageUseCase,
  SendChatMessageUseCase,
  RunLlmTurnUseCase,
  StreamLlmTurnUseCase,
];

@Module({
  imports: [LlmInfrastructureModule],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class LlmUseCasesModule {}
