import { Module } from '@nestjs/common';
import { RagUseCasesModule } from '../use-cases/rag/rag-use-cases.module';
import { TrunkMergedReindexer } from './trunk-merged-reindexer';

/** Serviço de fundo, sem rota: reindexa o RAG do projeto no merge na trunk (RN-1108). */
@Module({
  imports: [RagUseCasesModule],
  providers: [TrunkMergedReindexer],
})
export class RagReindexModule {}
