import { Module } from '@nestjs/common';
import { RequestRunnerTicketUseCase } from './request-runner-ticket.use-case';
import { ListRunnerProjectsUseCase } from './list-runner-projects.use-case';
import { EngineHttpClientsModule } from '../../../infrastructure/http-clients/engine-http-clients.module';
import { IamUseCasesModule } from '../iam/iam-use-cases.module';

const USE_CASES = [RequestRunnerTicketUseCase, ListRunnerProjectsUseCase];

/**
 * `IamUseCasesModule` entrou pela RN-543 (ADR 0154 ponto 3):
 * `ListRunnerProjectsUseCase` aplica o mínimo `developer` por LINHA com
 * `ResolveEffectiveRoleUseCase`, que mora lá — a régua única do produto, em
 * vez de um `??` reescrito em SQL. Não fecha ciclo: `IamUseCasesModule`
 * importa Filesystem/Sessions/Containers, e nenhum deles importa este.
 */
@Module({
  imports: [EngineHttpClientsModule, IamUseCasesModule],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class RunnerUseCasesModule {}
