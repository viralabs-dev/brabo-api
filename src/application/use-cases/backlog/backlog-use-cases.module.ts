import { Module } from '@nestjs/common';
import { SessionsUseCasesModule } from '../sessions/sessions-use-cases.module';
import { CreateEpicUseCase } from './create-epic.use-case';
import { CreateStoryUseCase } from './create-story.use-case';
import { CreateTaskUseCase } from './create-task.use-case';
import { TransitionStoryUseCase } from './transition-story.use-case';
import { ListBacklogUseCase } from './list-backlog.use-case';
import { GetCoverageUseCase } from './get-coverage.use-case';

const USE_CASES = [
  CreateEpicUseCase,
  CreateStoryUseCase,
  CreateTaskUseCase,
  TransitionStoryUseCase,
  ListBacklogUseCase,
  GetCoverageUseCase,
];

@Module({
  imports: [SessionsUseCasesModule],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class BacklogUseCasesModule {}
