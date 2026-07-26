import { Module } from '@nestjs/common';
import { SessionsUseCasesModule } from '../sessions/sessions-use-cases.module';
import { EngineHttpClientsModule } from '../../../infrastructure/http-clients/engine-http-clients.module';
import { IamUseCasesModule } from '../iam/iam-use-cases.module';
import { InstructionsUseCasesModule } from '../instructions/instructions-use-cases.module';
import { GetAnamneseContextUseCase } from './get-anamnese-context.use-case';
import { RunAnamneseUseCase } from './run-anamnese.use-case';
import { RecordProficiencyUseCase } from './record-proficiency.use-case';
import {
  DeleteProficiencyProfileUseCase,
  ListProficiencyProfilesUseCase,
  SetAnamneseOptInUseCase,
} from './manage-proficiency.use-case';

const USE_CASES = [
  GetAnamneseContextUseCase,
  RecordProficiencyUseCase,
  RunAnamneseUseCase,
  ListProficiencyProfilesUseCase,
  DeleteProficiencyProfileUseCase,
  SetAnamneseOptInUseCase,
];

@Module({
  imports: [
    SessionsUseCasesModule,
    InstructionsUseCasesModule,
    // RunAnamneseUseCase dispara a rodada no engine.
    EngineHttpClientsModule,
    // ListProficiencyProfilesUseCase resolve o papel pra decidir entre "o seu
    // perfil" e a visão do time.
    IamUseCasesModule,
  ],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class AnamneseUseCasesModule {}
