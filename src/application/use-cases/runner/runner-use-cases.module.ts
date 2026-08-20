import { Module } from '@nestjs/common';
import { RequestRunnerTicketUseCase } from './request-runner-ticket.use-case';
import { EngineHttpClientsModule } from '../../../infrastructure/http-clients/engine-http-clients.module';

const USE_CASES = [RequestRunnerTicketUseCase];

@Module({
  imports: [EngineHttpClientsModule],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class RunnerUseCasesModule {}
