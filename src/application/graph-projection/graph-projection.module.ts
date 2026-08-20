import { Module } from '@nestjs/common';
import { GraphUseCasesModule } from '../use-cases/graph/graph-use-cases.module';
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
  imports: [GraphUseCasesModule],
  providers: [GraphProjector],
  exports: [GraphProjector],
})
export class GraphProjectionModule {}
