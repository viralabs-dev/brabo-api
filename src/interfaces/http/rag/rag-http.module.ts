import { Module } from '@nestjs/common';
import { RagUseCasesModule } from '../../../application/use-cases/rag/rag-use-cases.module';
import { RagController } from './rag.controller';
import { SourceClicksController } from './source-clicks.controller';

@Module({
  imports: [RagUseCasesModule],
  controllers: [RagController, SourceClicksController],
})
export class RagHttpModule {}
