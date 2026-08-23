import { Module } from '@nestjs/common';
import { SessionsUseCasesModule } from '../sessions/sessions-use-cases.module';
import { EngineHttpClientsModule } from '../../../infrastructure/http-clients/engine-http-clients.module';
import { ActivateAgentUseCase } from './activate-agent.use-case';
import { SendAgentMessageUseCase } from './send-agent-message.use-case';
import { ConfirmReadinessUseCase } from './confirm-readiness.use-case';
import { OfferInfraHandoffUseCase } from './offer-infra-handoff.use-case';
import { ValidateNecessityUseCase } from './validate-necessity.use-case';
import { CreateHandoffUseCase } from './create-handoff.use-case';
import { AcceptHandoffUseCase } from './accept-handoff.use-case';
import { ListHandoffsUseCase } from './list-handoffs.use-case';
import { RequestManualHandoffUseCase } from './request-manual-handoff.use-case';
import { UpsertAgentInstructionUseCase } from './upsert-agent-instruction.use-case';
import { CancelAgentTurnUseCase } from './cancel-agent-turn.use-case';
import { AnswerStructuredQuestionUseCase } from './answer-structured-question.use-case';

const USE_CASES = [
  ActivateAgentUseCase,
  SendAgentMessageUseCase,
  ConfirmReadinessUseCase,
  OfferInfraHandoffUseCase,
  ValidateNecessityUseCase,
  CreateHandoffUseCase,
  AcceptHandoffUseCase,
  ListHandoffsUseCase,
  RequestManualHandoffUseCase,
  UpsertAgentInstructionUseCase,
  CancelAgentTurnUseCase,
  AnswerStructuredQuestionUseCase,
];

@Module({
  imports: [SessionsUseCasesModule, EngineHttpClientsModule],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class AgentsUseCasesModule {}
