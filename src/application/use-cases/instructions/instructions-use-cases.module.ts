import { forwardRef, Module } from '@nestjs/common';
import { SessionsUseCasesModule } from '../sessions/sessions-use-cases.module';
import { EngineHttpClientsModule } from '../../../infrastructure/http-clients/engine-http-clients.module';
import { ActionsUseCasesModule } from '../actions/actions-use-cases.module';
import { ApplyInstructionVersionService } from './apply-instruction-version.service';
import { RollbackInstructionUseCase } from './rollback-instruction.use-case';
import { ListInstructionVersionsUseCase } from './list-instruction-versions.use-case';
import { ProposeInstructionPatchUseCase } from './propose-instruction-patch.use-case';

const USE_CASES = [
  ApplyInstructionVersionService,
  RollbackInstructionUseCase,
  ListInstructionVersionsUseCase,
  ProposeInstructionPatchUseCase,
];

@Module({
  imports: [
    SessionsUseCasesModule,
    EngineHttpClientsModule,
    forwardRef(() => ActionsUseCasesModule),
  ],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class InstructionsUseCasesModule {}
