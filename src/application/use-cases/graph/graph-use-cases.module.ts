import { Module } from '@nestjs/common';
import { Neo4jModule } from '../../../infrastructure/graph/neo4j.module';
import { UpsertPromptTemplateUseCase } from './upsert-prompt-template.use-case';
import { GetPromptTemplateUseCase } from './get-prompt-template.use-case';
import { RecordInteractionUseCase } from './record-interaction.use-case';
import { RecordHypothesisUseCase } from './record-hypothesis.use-case';
import { RecordAnamneseProfileUseCase } from './record-anamnese-profile.use-case';
import { RecordHandoffUseCase } from './record-handoff.use-case';
import { QueryUserContextUseCase } from './query-user-context.use-case';

const USE_CASES = [
  UpsertPromptTemplateUseCase,
  GetPromptTemplateUseCase,
  RecordInteractionUseCase,
  RecordHypothesisUseCase,
  RecordAnamneseProfileUseCase,
  RecordHandoffUseCase,
  QueryUserContextUseCase,
];

/**
 * Fundação do grafo de conhecimento (Neo4j) — templates de prompt
 * versionados e memória relacional (interações, hipóteses, perfis, handoffs).
 * Ver `GraphStore` para a degradação e `graph-types.ts` para os tipos.
 *
 * Nenhum consumidor real chama estes casos de uso ainda além de
 * `InternalGraphController` (só os de template) — os de memória relacional
 * ficam prontos para a Onda 2, que vai chamá-los a partir do replay do
 * outbox.
 */
@Module({
  imports: [Neo4jModule],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class GraphUseCasesModule {}
