import { Module } from '@nestjs/common';
import { AnamneseUseCasesModule } from '../../../application/use-cases/anamnese/anamnese-use-cases.module';
import { InstructionsUseCasesModule } from '../../../application/use-cases/instructions/instructions-use-cases.module';
import { SessionsUseCasesModule } from '../../../application/use-cases/sessions/sessions-use-cases.module';
import { AnamneseController } from './anamnese.controller';

@Module({
  imports: [
    AnamneseUseCasesModule,
    InstructionsUseCasesModule,
    // GetProjectEventUseCase: resolve a sessão de um event id pro chip de
    // evidência do perfil.
    SessionsUseCasesModule,
  ],
  controllers: [AnamneseController],
})
export class AnamneseHttpModule {}
