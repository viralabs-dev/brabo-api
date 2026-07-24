import { Module } from '@nestjs/common';
import { SessionsUseCasesModule } from '../sessions/sessions-use-cases.module';
import { CreateModuleMapUseCase } from './create-module-map.use-case';
import { AssignStoryModulesUseCase } from './assign-story-modules.use-case';
import { GetArchitectureUseCase } from './get-architecture.use-case';

const USE_CASES = [
  CreateModuleMapUseCase,
  AssignStoryModulesUseCase,
  GetArchitectureUseCase,
];

@Module({
  imports: [SessionsUseCasesModule],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class ArchitectureUseCasesModule {}
