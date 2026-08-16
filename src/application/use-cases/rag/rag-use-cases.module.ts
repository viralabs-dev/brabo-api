import { Module } from '@nestjs/common';
import { GitUseCasesModule } from '../git/git-use-cases.module';
import { LlmInfrastructureModule } from '../../../infrastructure/llm/llm-infrastructure.module';
import { RagEmbeddingService } from './rag-embedding.service';
import { IndexProjectDocsUseCase } from './index-project-docs.use-case';
import { IndexSessionUseCase } from './index-session.use-case';
import { ReindexProjectUseCase } from './reindex-project.use-case';
import { GetRagCoverageUseCase } from './get-rag-coverage.use-case';
import { HybridSearchUseCase } from './hybrid-search.use-case';

const USE_CASES = [
  RagEmbeddingService,
  IndexProjectDocsUseCase,
  IndexSessionUseCase,
  ReindexProjectUseCase,
  GetRagCoverageUseCase,
  HybridSearchUseCase,
];

/**
 * O pipeline de indexação e a busca híbrida do Chat RAG (PROGRAMA 28, Onda
 * 4, frente G2 — ADR 0080).
 *
 * `GitUseCasesModule` entra por `ReadProjectCodeUseCase` — a indexação de
 * `docs`/`adr` lê o repositório do PRÓPRIO projeto, com a mesma resolução
 * de credencial e o mesmo portão de container que a aba Code já usa.
 * `LlmInfrastructureModule` entra por `LLMProviderRegistry`, que
 * `RagEmbeddingService` usa para chamar `embed`. `ChunkRepository`,
 * `ProjectRepository`, `SessionRepository` e `SessionEventRepository` são
 * `@Global()` via `DrizzleModule` — nenhum import extra para eles.
 */
@Module({
  imports: [GitUseCasesModule, LlmInfrastructureModule],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class RagUseCasesModule {}
