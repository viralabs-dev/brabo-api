import { Module } from '@nestjs/common';
import { SessionsUseCasesModule } from '../sessions/sessions-use-cases.module';
import { GitUseCasesModule } from '../git/git-use-cases.module';
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
  // `GitUseCasesModule` entra pelo gatilho da RN-522: aceitar o handoff para o
  // Dev Lead provisiona o repositório. A seta é esta e não a contrária — quem
  // aceita o handoff depende do provisionamento, e o provisionamento não sabe
  // que handoff existe. `git-use-cases.module.ts` não importa este módulo, então
  // não há ciclo.
  imports: [SessionsUseCasesModule, GitUseCasesModule, EngineHttpClientsModule],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class AgentsUseCasesModule {}
