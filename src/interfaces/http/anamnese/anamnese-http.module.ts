import { Module } from '@nestjs/common';
import { AnamneseUseCasesModule } from '../../../application/use-cases/anamnese/anamnese-use-cases.module';
import { InstructionsUseCasesModule } from '../../../application/use-cases/instructions/instructions-use-cases.module';
import { AnamneseController } from './anamnese.controller';

@Module({
  imports: [AnamneseUseCasesModule, InstructionsUseCasesModule],
  controllers: [AnamneseController],
})
export class AnamneseHttpModule {}
