import { Module } from '@nestjs/common';
import { RunnerUseCasesModule } from '../../../application/use-cases/runner/runner-use-cases.module';
import { RunnerTicketsController } from './runner-tickets.controller';

@Module({
  imports: [RunnerUseCasesModule],
  controllers: [RunnerTicketsController],
})
export class RunnerHttpModule {}
