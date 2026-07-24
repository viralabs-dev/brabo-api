import { Module } from '@nestjs/common';
import { SessionsUseCasesModule } from '../sessions/sessions-use-cases.module';
import { InstructionsUseCasesModule } from '../instructions/instructions-use-cases.module';
import { GetAnamneseContextUseCase } from './get-anamnese-context.use-case';
import { RecordProficiencyUseCase } from './record-proficiency.use-case';
import {
  DeleteProficiencyProfileUseCase,
  ListProficiencyProfilesUseCase,
  SetAnamneseOptInUseCase,
} from './manage-proficiency.use-case';

const USE_CASES = [
  GetAnamneseContextUseCase,
  RecordProficiencyUseCase,
  ListProficiencyProfilesUseCase,
  DeleteProficiencyProfileUseCase,
  SetAnamneseOptInUseCase,
];

@Module({
  imports: [SessionsUseCasesModule, InstructionsUseCasesModule],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class AnamneseUseCasesModule {}
