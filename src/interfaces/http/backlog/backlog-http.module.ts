import { Module } from '@nestjs/common';
import { BacklogUseCasesModule } from '../../../application/use-cases/backlog/backlog-use-cases.module';
import { BacklogController } from './backlog.controller';

@Module({
  imports: [BacklogUseCasesModule],
  controllers: [BacklogController],
})
export class BacklogHttpModule {}
