import type { ActorKind } from '../../domain/sessions/session-event.entity';
import type {
  RagSearchHitTelemetry,
  RagSearchWeights,
  RagVerdict,
} from '../../domain/rag/rag-telemetry';

/**
 * O rastro da busca híbrida (RN-479/480/481) — a FONTE da medição de
 * `medir:rag`.
 *
 * Porta separada de `ChunkRepository` de propósito: `chunks` é o índice (o que
 * a busca lê) e `rag_searches`/`rag_feedback` são a observação da busca (o que
 * a busca deixa). Juntar as duas faria toda dependência do índice arrastar a
 * telemetria junto, e a telemetria é a única das duas cuja falha NÃO pode
 * derrubar a busca.
 */

export interface NewRagSearch {
  projectId: string;
  /** NULL = veio da aba de RAG (busca de projeto), não de um agente. */
  sessionId: string | null;
  actorKind: ActorKind;
  actorId: string;
  query: string;
  topK: number;
  hits: RagSearchHitTelemetry[];
  degraded: boolean;
  vectorAvailable: boolean;
  /** Os pesos do MOMENTO da busca, já copiados por `pesosVigentes()`. */
  pesos: RagSearchWeights;
  latencyMs: number;
}

export interface RagSearchRecord extends NewRagSearch {
  id: string;
  createdAt: Date;
}

export interface NewRagFeedback {
  searchId: string;
  chunkId: string;
  verdict: RagVerdict;
  actorKind: ActorKind;
  actorId: string;
}

export interface RagFeedbackRecord extends NewRagFeedback {
  id: string;
  createdAt: Date;
}

export abstract class RagTelemetryRepository {
  /** Grava UMA busca. Quem chama trata a falha — ela nunca derruba a busca. */
  abstract recordSearch(input: NewRagSearch): Promise<RagSearchRecord>;

  /**
   * A busca pelo id, para validar a referência de um voto. Devolve `null`
   * quando o id não existe — é o caso de recusa, e ele é uma resposta, não uma
   * exceção de infraestrutura.
   */
  abstract findSearchById(id: string): Promise<RagSearchRecord | null>;

  /**
   * Grava (ou REGRAVA) o voto. Um ator que muda de ideia sobre o mesmo trecho
   * da mesma busca sobrescreve o próprio voto em vez de somar um segundo — é o
   * que a unique `(search_id, chunk_id, actor_id)` decide, e o repositório
   * respeita com `onConflictDoUpdate`.
   */
  abstract recordFeedback(input: NewRagFeedback): Promise<RagFeedbackRecord>;
}
