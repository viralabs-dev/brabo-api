import { Module } from '@nestjs/common';
import { ExecutionUseCasesModule } from '../../../application/use-cases/execution/execution-use-cases.module';
import { PsychologistController } from './psychologist.controller';

@Module({
  imports: [ExecutionUseCasesModule],
  controllers: [PsychologistController],
})
export class PsychologistHttpModule {}
