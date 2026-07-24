import { Module } from '@nestjs/common';
import { ExecutionUseCasesModule } from '../../../application/use-cases/execution/execution-use-cases.module';
import { ExecutionController } from './execution.controller';

@Module({
  imports: [ExecutionUseCasesModule],
  controllers: [ExecutionController],
})
export class ExecutionHttpModule {}
