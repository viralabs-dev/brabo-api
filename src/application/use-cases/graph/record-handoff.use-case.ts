import { Injectable } from '@nestjs/common';
import { GraphStore } from '../../../infrastructure/graph/graph-store';
import type { HandoffRecord } from '../../../domain/graph/graph-types';

/**
 * Registra um handoff entre agentes:
 * `(:Handoff {sessionId, seq})-[:DE]->(:Agente {slug})`,
 * `(:Handoff)-[:PARA]->(:Agente {slug})`.
 *
 * ## Chave natural: `(sessionId, seq)`, exatamente como o schema pede
 *
 * Diferente da hipótese, um handoff NÃO tem id próprio e estável no domínio
 * (a tabela `handoffs` tem `id`, mas o que a Onda 2 vai ter à mão ao
 * processar o outbox é o evento — `sessionId` + `seq`). `MERGE` nesse par
 * garante que reprocessar o MESMO evento de handoff nunca cria um segundo nó
 * — `seq` é gapless por sessão (RN-155), então o par é tão estável quanto um
 * id.
 */
@Injectable()
export class RecordHandoffUseCase {
  constructor(private readonly graph: GraphStore) {}

  async execute(input: HandoffRecord): Promise<void> {
    await this.graph.executeWrite(async (tx) => {
      await tx.run(
        `MERGE (h:Handoff {sessionId: $sessionId, seq: $seq})
         MERGE (de:Agente {slug: $fromAgent})
         MERGE (para:Agente {slug: $toAgent})
         MERGE (h)-[:DE]->(de)
         MERGE (h)-[:PARA]->(para)`,
        {
          sessionId: input.sessionId,
          seq: input.seq,
          fromAgent: input.fromAgent,
          toAgent: input.toAgent,
        },
      );
    });
  }
}
