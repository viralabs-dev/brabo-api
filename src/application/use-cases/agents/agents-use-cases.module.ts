import { Module } from '@nestjs/common';
import { SessionsUseCasesModule } from '../sessions/sessions-use-cases.module';
import { GitUseCasesModule } from '../git/git-use-cases.module';
import { EngineHttpClientsModule } from '../../../infrastructure/http-clients/engine-http-clients.module';
// RN-680 (ADR 0196): a mensagem ao agente leva os fatos do perfil do autor,
// lidos do grafo por `QueryUserContextUseCase`.
import { GraphUseCasesModule } from '../graph/graph-use-cases.module';
import { ActivateAgentUseCase } from './activate-agent.use-case';
import { SendAgentMessageUseCase } from './send-agent-message.use-case';
import { ConfirmReadinessUseCase } from './confirm-readiness.use-case';
import { OfferInfraHandoffUseCase } from './offer-infra-handoff.use-case';
import { ValidateNecessityUseCase } from './validate-necessity.use-case';
import { CreateHandoffUseCase } from './create-handoff.use-case';
import { AcceptHandoffUseCase } from './accept-handoff.use-case';
import { AceiteImplicitoDoPoUseCase } from './aceite-implicito-do-po.use-case';
import { ListHandoffsUseCase } from './list-handoffs.use-case';
import { RequestManualHandoffUseCase } from './request-manual-handoff.use-case';
import { UpsertAgentInstructionUseCase } from './upsert-agent-instruction.use-case';
import { CancelAgentTurnUseCase } from './cancel-agent-turn.use-case';
import { CancelQueuedAgentMessageUseCase } from './cancel-queued-agent-message.use-case';
import { AnswerStructuredQuestionUseCase } from './answer-structured-question.use-case';
import { CicloDeVidaDoHandoff } from './ciclo-de-vida-do-handoff.service';
import { AceitarHandoffAutomaticamenteUseCase } from './aceitar-handoff-automaticamente.use-case';
// Provider direto pelo mesmo motivo do de baixo: o aceite automático (RN-660)
// confere o papel de quem abriu a sessão, e a classe só lê repositórios do
// `DrizzleModule`, que é global.
import { ResolveEffectiveRoleUseCase } from '../iam/resolve-effective-role.use-case';
// Provider direto, e não `imports: [IamUseCasesModule]` (o mesmo argumento do
// `SeedAgentAreasUseCase` no sentido contrário): a resolução do idioma da
// resposta (RN-618/RN-622) só lê dois repositórios do `DrizzleModule`, que é
// global, e importar o módulo de IAM traria aresta nova por uma classe sem
// estado.
import { ResolverIdiomaDaRespostaUseCase } from '../iam/resolver-idioma-da-resposta.use-case';

const USE_CASES = [
  ActivateAgentUseCase,
  SendAgentMessageUseCase,
  ConfirmReadinessUseCase,
  OfferInfraHandoffUseCase,
  ValidateNecessityUseCase,
  CreateHandoffUseCase,
  AcceptHandoffUseCase,
  AceiteImplicitoDoPoUseCase,
  ListHandoffsUseCase,
  RequestManualHandoffUseCase,
  UpsertAgentInstructionUseCase,
  CancelAgentTurnUseCase,
  CancelQueuedAgentMessageUseCase,
  AnswerStructuredQuestionUseCase,
  CicloDeVidaDoHandoff,
  AceitarHandoffAutomaticamenteUseCase,
];

@Module({
  // `GitUseCasesModule` entra pelo gatilho da RN-582 (antes RN-522): aceitar o
  // handoff para o Arquiteto — e, como segunda porta, para o Dev Lead —
  // provisiona o repositório. A seta é esta e não a contrária — quem
  // aceita o handoff depende do provisionamento, e o provisionamento não sabe
  // que handoff existe. `git-use-cases.module.ts` não importa este módulo, então
  // não há ciclo.
  imports: [
    SessionsUseCasesModule,
    GitUseCasesModule,
    EngineHttpClientsModule,
    GraphUseCasesModule,
  ],
  providers: [
    ...USE_CASES,
    ResolverIdiomaDaRespostaUseCase,
    ResolveEffectiveRoleUseCase,
  ],
  exports: USE_CASES,
})
export class AgentsUseCasesModule {}
