import { Module } from '@nestjs/common';
import { CreateSessionUseCase } from './create-session.use-case';
import { GetSessionUseCase } from './get-session.use-case';
import { TransitionSessionUseCase } from './transition-session.use-case';
import { AppendSessionEventUseCase } from './append-session-event.use-case';
import { ListSessionEventsUseCase } from './list-session-events.use-case';

const USE_CASES = [
  CreateSessionUseCase,
  GetSessionUseCase,
  TransitionSessionUseCase,
  AppendSessionEventUseCase,
  ListSessionEventsUseCase,
];

@Module({
  providers: USE_CASES,
  exports: USE_CASES,
})
export class SessionsUseCasesModule {}
