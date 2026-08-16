import { Module } from '@nestjs/common';
import { RagUseCasesModule } from '../../../application/use-cases/rag/rag-use-cases.module';
import { RagController } from './rag.controller';

@Module({
  imports: [RagUseCasesModule],
  controllers: [RagController],
})
export class RagHttpModule {}
