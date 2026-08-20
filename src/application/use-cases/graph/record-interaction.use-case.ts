import { Injectable } from '@nestjs/common';
import { GraphStore } from '../../../infrastructure/graph/graph-store';
import type { InteractionRecord } from '../../../domain/graph/graph-types';

/**
 * Registra a participação de um usuário numa sessão
 * `(:Usuario)-[:PARTICIPOU]->(:Interacao)-[:NO_PROJETO]->(:Projeto)`.
 *
 * ## Chave natural: `sessionId`
 *
 * UMA `Interacao` por sessão, não uma por chamada. A Onda 2 (replay de
 * outbox) vai chamar este caso de uso repetidas vezes conforme a sessão
 * avança — cada chamada é o mesmo evento de progresso sendo reprocessado ou
 * uma extensão real da janela. `MERGE` em `sessionId` garante que replay
 * nunca cria uma segunda `Interacao` para a mesma sessão; o `seqInicio`/
 * `seqFim` da janela é estendido de forma MONÓTONA (menor início, maior fim),
 * então processar o mesmo intervalo duas vezes ou fora de ordem chega ao
 * mesmo estado final — idempotência real, não só "não duplica nó".
 */
@Injectable()
export class RecordInteractionUseCase {
  constructor(private readonly graph: GraphStore) {}

  async execute(input: InteractionRecord): Promise<void> {
    await this.graph.executeWrite(async (tx) => {
      // A `Interacao` é casada/criada PRIMEIRO, sozinha, pela chave natural —
      // `MERGE (u)-[:PARTICIPOU]->(i:Interacao {sessionId})` casaria o
      // PADRÃO inteiro (nó + relação), e criaria uma segunda `Interacao` para
      // a mesma sessão se ela já existisse ligada a outro nó `Usuario` (ou
      // antes de qualquer `Usuario` existir). Separar em três `MERGE`
      // independentes é o que torna o `sessionId` de fato único.
      await tx.run(
        `MERGE (i:Interacao {sessionId: $sessionId})
         ON CREATE SET i.seqInicio = $seqInicio, i.seqFim = $seqFim
         ON MATCH SET
           i.seqInicio = CASE WHEN $seqInicio < i.seqInicio THEN $seqInicio ELSE i.seqInicio END,
           i.seqFim = CASE WHEN $seqFim > i.seqFim THEN $seqFim ELSE i.seqFim END
         MERGE (u:Usuario {id: $userId})
         MERGE (p:Projeto {id: $projectId})
         MERGE (u)-[:PARTICIPOU]->(i)
         MERGE (i)-[:NO_PROJETO]->(p)`,
        {
          userId: input.userId,
          projectId: input.projectId,
          sessionId: input.sessionId,
          seqInicio: input.seqInicio,
          seqFim: input.seqFim,
        },
      );
    });
  }
}
