import { Injectable } from '@nestjs/common';
import { GraphStore } from '../../../infrastructure/graph/graph-store';
import type { ProfileFactRecord } from '../../../domain/graph/graph-types';

/**
 * Registra um FATO do perfil da pessoa (RN-680, ADR 0196):
 * `(:FatoDoPerfil {hypothesisId})-[:SOBRE]->(:Usuario)` e
 * `(:FatoDoPerfil)-[:NO_PROJETO]->(:Projeto)`.
 *
 * O fato é uma hipótese do Psicólogo que a PRÓPRIA pessoa aceitou. Chave
 * natural `hypothesisId`: cada hipótese aceita é um fato, e reprocessar o
 * mesmo evento de aceite converge para o mesmo nó (`SET` nos campos, `MERGE`
 * nas arestas) — é o que torna a reprojeção (`grafo:reprojetar`) segura.
 *
 * O projeto é ARESTA, e não só propriedade, para a leitura escopada
 * (`QueryUserContextUseCase`) andar pelo mesmo `Projeto` que as interações já
 * usam.
 */
@Injectable()
export class RecordProfileFactUseCase {
  constructor(private readonly graph: GraphStore) {}

  async execute(input: ProfileFactRecord): Promise<void> {
    await this.graph.executeWrite(async (tx) => {
      await tx.run(
        `MERGE (u:Usuario {id: $userId})
         MERGE (p:Projeto {id: $projectId})
         MERGE (f:FatoDoPerfil {hypothesisId: $hypothesisId})
         SET f.agenteAlvo = $agenteAlvo,
             f.hipotese = $hipotese,
             f.sugestao = $sugestao,
             f.aceitoEm = $aceitoEm
         MERGE (f)-[:SOBRE]->(u)
         MERGE (f)-[:NO_PROJETO]->(p)`,
        {
          hypothesisId: input.hypothesisId,
          userId: input.userId,
          projectId: input.projectId,
          agenteAlvo: input.agenteAlvo,
          hipotese: input.hipotese,
          sugestao: input.sugestao,
          aceitoEm: input.aceitoEm,
        },
      );
    });
  }
}
