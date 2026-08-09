import { Module } from '@nestjs/common';
import { CreateSessionUseCase } from './create-session.use-case';
import { GetSessionUseCase } from './get-session.use-case';
import { ListSessionsForProjectUseCase } from './list-sessions-for-project.use-case';
import { RenameSessionUseCase } from './rename-session.use-case';
import { TransitionSessionUseCase } from './transition-session.use-case';
import { AppendSessionEventUseCase } from './append-session-event.use-case';
import { ListSessionEventsUseCase } from './list-session-events.use-case';
import { GetSessionEventUseCase } from './get-session-event.use-case';
import { GetProjectEventUseCase } from './get-project-event.use-case';
import { ReportSessionTerminationUseCase } from './report-session-termination.use-case';
import { GetSessionPendingWorkUseCase } from './get-session-pending-work.use-case';
import { EngineHttpClientsModule } from '../../../infrastructure/http-clients/engine-http-clients.module';

const USE_CASES = [
  CreateSessionUseCase,
  GetSessionUseCase,
  ListSessionsForProjectUseCase,
  RenameSessionUseCase,
  TransitionSessionUseCase,
  AppendSessionEventUseCase,
  ListSessionEventsUseCase,
  GetSessionEventUseCase,
  GetProjectEventUseCase,
  ReportSessionTerminationUseCase,
  GetSessionPendingWorkUseCase,
];

@Module({
  imports: [EngineHttpClientsModule],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class SessionsUseCasesModule {}
