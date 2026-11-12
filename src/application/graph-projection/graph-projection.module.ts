import { Module } from '@nestjs/common';
import { Neo4jModule } from '../../infrastructure/graph/neo4j.module';
import { GraphUseCasesModule } from '../use-cases/graph/graph-use-cases.module';
import { ArchitectureUseCasesModule } from '../use-cases/architecture/architecture-use-cases.module';
import { GitUseCasesModule } from '../use-cases/git/git-use-cases.module';
import { MemoriaDoProjetoTranslator } from './memoria-do-projeto-translator';
import { GraphProjector } from './graph-projector';

/**
 * Onda 2 da fundação do grafo de conhecimento — o `GraphProjector` roda
 * como serviço de fundo (poller sobre `outbox_events`), independente de
 * qualquer rota HTTP. `OutboxRepository`/`SessionRepository`/
 * `SessionEventRepository` vêm do `DrizzleModule`, que é `@Global()` — só
 * os casos de uso de gravação do grafo (`GraphUseCasesModule`, que já
 * embute `Neo4jModule`) precisam ser importados aqui.
 */
@Module({
  imports: [Neo4jModule, GraphUseCasesModule, GitUseCasesModule, ArchitectureUseCasesModule],
  providers: [GraphProjector, MemoriaDoProjetoTranslator],
  exports: [GraphProjector],
})
export class GraphProjectionModule {}
