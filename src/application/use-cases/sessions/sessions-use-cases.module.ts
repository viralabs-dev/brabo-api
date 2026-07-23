import { Module } from '@nestjs/common';
import { CreateSessionUseCase } from './create-session.use-case';
import { GetSessionUseCase } from './get-session.use-case';
import { TransitionSessionUseCase } from './transition-session.use-case';
import { AppendSessionEventUseCase } from './append-session-event.use-case';
import { ListSessionEventsUseCase } from './list-session-events.use-case';
import { ReportSessionTerminationUseCase } from './report-session-termination.use-case';
import { EngineHttpClientsModule } from '../../../infrastructure/http-clients/engine-http-clients.module';

const USE_CASES = [
  CreateSessionUseCase,
  GetSessionUseCase,
  TransitionSessionUseCase,
  AppendSessionEventUseCase,
  ListSessionEventsUseCase,
  ReportSessionTerminationUseCase,
];

@Module({
  imports: [EngineHttpClientsModule],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class SessionsUseCasesModule {}
