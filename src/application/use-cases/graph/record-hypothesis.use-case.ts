import { Injectable } from '@nestjs/common';
import { GraphStore } from '../../../infrastructure/graph/graph-store';
import type { HypothesisRecord } from '../../../domain/graph/graph-types';

/**
 * Registra uma hipótese do Psicólogo no grafo:
 * `(:Hipotese {id})-[:EVIDENCIA]->(:Evento {sessionId, seq})`.
 *
 * ## Chave natural: `hypothesisId` (não `(sessionId, seq)`)
 *
 * Diferente do `Handoff` (que não tem id próprio no domínio — só nasce como
 * evento na sessão), a hipótese JÁ tem um id estável no Postgres
 * (`psychologist_hypotheses.id`, atribuído por `ProposeHypothesesUseCase`
 * antes de qualquer chamada ao grafo chegar aqui). Reusar esse id como chave
 * de `MERGE` é mais forte que derivar de `(sessionId, seq)`: o `Hipotese`
 * não representa UM evento, representa a conclusão que o Psicólogo tirou de
 * VÁRIOS — os `seq` das evidências são as ARESTAS, não o nó.
 *
 * `SET` (não `ON CREATE SET`) em `descricao`/`status` é proposital: se o
 * status mudar (ex.: hipótese aceita e depois superseded), o replay do MESMO
 * evento de origem sempre converge para o estado mais recente — idempotência
 * de "resultado final", não só de "não duplica nó".
 *
 * As arestas `EVIDENCIA` são cumulativas: reprocessar a mesma lista de
 * `evidenceSeqs` não duplica (MERGE por par sessionId+seq), mas uma evidência
 * removida numa reemissão não é apagada aqui — fora do escopo desta
 * fundação, que ninguém ainda consome.
 */
@Injectable()
export class RecordHypothesisUseCase {
  constructor(private readonly graph: GraphStore) {}

  async execute(input: HypothesisRecord): Promise<void> {
    await this.graph.executeWrite(async (tx) => {
      await tx.run(
        `MERGE (h:Hipotese {id: $hypothesisId})
         SET h.sessionId = $sessionId, h.descricao = $descricao, h.status = $status
         WITH h
         UNWIND $evidenceSeqs AS seq
         MERGE (e:Evento {sessionId: $sessionId, seq: seq})
         MERGE (h)-[:EVIDENCIA]->(e)`,
        {
          hypothesisId: input.hypothesisId,
          sessionId: input.sessionId,
          descricao: input.descricao,
          status: input.status,
          evidenceSeqs: input.evidenceSeqs,
        },
      );
    });
  }
}
