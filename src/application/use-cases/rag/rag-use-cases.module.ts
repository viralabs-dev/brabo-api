import { Module } from '@nestjs/common';
import { GitUseCasesModule } from '../git/git-use-cases.module';
import { SessionsUseCasesModule } from '../sessions/sessions-use-cases.module';
import { LlmInfrastructureModule } from '../../../infrastructure/llm/llm-infrastructure.module';
import { RagEmbeddingService } from './rag-embedding.service';
import { IndexProjectDocsUseCase } from './index-project-docs.use-case';
import { IndexSessionUseCase } from './index-session.use-case';
import { IndexLocalFolderUseCase } from './index-local-folder.use-case';
import { ReindexProjectUseCase } from './reindex-project.use-case';
import { GetRagCoverageUseCase } from './get-rag-coverage.use-case';
import { HybridSearchUseCase } from './hybrid-search.use-case';
import { RecordRagFeedbackUseCase } from './record-rag-feedback.use-case';

const USE_CASES = [
  RagEmbeddingService,
  IndexProjectDocsUseCase,
  IndexSessionUseCase,
  IndexLocalFolderUseCase,
  ReindexProjectUseCase,
  GetRagCoverageUseCase,
  HybridSearchUseCase,
  RecordRagFeedbackUseCase,
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
 * `RagTelemetryRepository`, `ProjectRepository`, `SessionRepository` e
 * `SessionEventRepository` são `@Global()` via `DrizzleModule` — nenhum
 * import extra para eles.
 *
 * `SessionsUseCasesModule` entra por `AppendSessionEventUseCase`: a
 * telemetria de busca (RN-479/481) NARRA `rag.search`/`rag.feedback` na
 * timeline quando há sessão, e o funil de append é um só — o mesmo que trava
 * `execution.activated` em sessão consultiva (RN-097). Não há ciclo: o módulo
 * de sessões não conhece o RAG.
 */
@Module({
  imports: [GitUseCasesModule, LlmInfrastructureModule, SessionsUseCasesModule],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class RagUseCasesModule {}
