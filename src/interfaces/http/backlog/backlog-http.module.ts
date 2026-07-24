import { Module } from '@nestjs/common';
import { BacklogUseCasesModule } from '../../../application/use-cases/backlog/backlog-use-cases.module';
import { ArchitectureUseCasesModule } from '../../../application/use-cases/architecture/architecture-use-cases.module';
import { ExecutionUseCasesModule } from '../../../application/use-cases/execution/execution-use-cases.module';
import { BacklogController } from './backlog.controller';

@Module({
  imports: [BacklogUseCasesModule, ArchitectureUseCasesModule, ExecutionUseCasesModule],
  controllers: [BacklogController],
})
export class BacklogHttpModule {}
