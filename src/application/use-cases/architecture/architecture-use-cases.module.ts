import { Module } from '@nestjs/common';
import { SessionsUseCasesModule } from '../sessions/sessions-use-cases.module';
import { CreateModuleMapUseCase } from './create-module-map.use-case';
import { AssignStoryModulesUseCase } from './assign-story-modules.use-case';
import { GetArchitectureUseCase } from './get-architecture.use-case';
import { CreateC4DiagramUseCase } from './create-c4-diagram.use-case';
import { GetC4DiagramUseCase } from './get-c4-diagram.use-case';
import { RouteModulesToInfraUseCase } from './route-modules-to-infra.use-case';
import { GetModuleRoutingUseCase } from './get-module-routing.use-case';

const USE_CASES = [
  CreateModuleMapUseCase,
  AssignStoryModulesUseCase,
  GetArchitectureUseCase,
  CreateC4DiagramUseCase,
  GetC4DiagramUseCase,
  RouteModulesToInfraUseCase,
  GetModuleRoutingUseCase,
];

@Module({
  imports: [SessionsUseCasesModule],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class ArchitectureUseCasesModule {}
