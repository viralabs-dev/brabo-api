import { Module } from '@nestjs/common';
import { GraphStore } from './graph-store';

/**
 * Expõe o `GraphStore` (Neo4j) como provider injetável. Sem uma segunda
 * classe "driver provider": diferente de Git/LLM, o grafo tem UMA
 * implementação só, e o próprio `GraphStore` cuida do ciclo de vida da
 * conexão (`OnModuleInit`/`OnModuleDestroy`) — não há interface a trocar.
 */
@Module({
  providers: [GraphStore],
  exports: [GraphStore],
})
export class Neo4jModule {}
