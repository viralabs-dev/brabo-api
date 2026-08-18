import { Module } from '@nestjs/common';
import { SessionsUseCasesModule } from '../sessions/sessions-use-cases.module';
// A recusa de promoção precisa avisar o PO no engine (Fase 12c) — é a
// primeira vez que o backlog atravessa a fronteira api→engine.
import { EngineHttpClientsModule } from '../../../infrastructure/http-clients/engine-http-clients.module';
import { CreateEpicUseCase } from './create-epic.use-case';
import { CreateStoryUseCase } from './create-story.use-case';
import { CreateTaskUseCase } from './create-task.use-case';
import { TransitionStoryUseCase } from './transition-story.use-case';
import { PromoteStoriesUseCase } from './promote-stories.use-case';
import { ReturnStoryUseCase } from './return-story.use-case';
import { ListBacklogUseCase } from './list-backlog.use-case';
import { GetCoverageUseCase } from './get-coverage.use-case';
import { ListBusinessRulesUseCase } from './list-business-rules.use-case';
import { ListProductMetricsUseCase } from './list-product-metrics.use-case';

const USE_CASES = [
  CreateEpicUseCase,
  CreateStoryUseCase,
  CreateTaskUseCase,
  TransitionStoryUseCase,
  PromoteStoriesUseCase,
  ReturnStoryUseCase,
  ListBacklogUseCase,
  GetCoverageUseCase,
  ListBusinessRulesUseCase,
  ListProductMetricsUseCase,
];

@Module({
  imports: [SessionsUseCasesModule, EngineHttpClientsModule],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class BacklogUseCasesModule {}
