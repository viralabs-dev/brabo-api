import { Module } from '@nestjs/common';
import { BacklogUseCasesModule } from '../../../application/use-cases/backlog/backlog-use-cases.module';
import { ArchitectureUseCasesModule } from '../../../application/use-cases/architecture/architecture-use-cases.module';
import { BacklogController } from './backlog.controller';

@Module({
  imports: [BacklogUseCasesModule, ArchitectureUseCasesModule],
  controllers: [BacklogController],
})
export class BacklogHttpModule {}
