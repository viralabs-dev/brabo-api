import type { Chunk, ChunkScope } from '../../application/ports/chunk-repository.port';

/**
 * O que conta como CITAÇÃO (RN-234, ADR 0080) — o contrato que o Chat RAG
 * (Onda 5, tela ainda não construída) vai mostrar ao lado de cada resposta.
 *
 * Discriminada por `kind` em vez de `sourcePath`/`sessionId` opcionais soltos
 * (o formato que `Chunk` já usa internamente): quem consome a citação nunca
 * deveria checar os dois campos para saber qual é `null` — o discriminante
 * torna a checagem exaustiva pelo `tsc`.
 */
export type ChunkOrigin =
  | {
      kind: 'file';
      sourcePath: string;
      /** Trilha de headings da seção de onde o trecho veio, quando há uma. */
      headingPath?: string[];
      title?: string;
    }
  | {
      kind: 'session';
      sessionId: string;
      /**
       * O evento do event log de onde o trecho veio — o mesmo id que
       * `GetSessionEventUseCase` resolve, para a UI poder navegar até o
       * ponto exato da sessão citado.
       */
      eventId?: string;
      /** Autor do trecho (`"user:<id>"`/`"agent:<slug>"`), para exibição. */
      title?: string;
    };

export function origemDoChunk(chunk: Chunk): ChunkOrigin {
  if (chunk.scope === 'session') {
    return {
      kind: 'session',
      sessionId: chunk.sessionId!,
      eventId: chunk.metadata.sourceRef,
      title: chunk.metadata.title,
    };
  }
  return {
    kind: 'file',
    sourcePath: chunk.sourcePath!,
    headingPath: chunk.metadata.headingPath,
    title: chunk.metadata.title,
  };
}

/** Um trecho recuperado pela busca híbrida, pronto para virar citação numerada. */
export interface HybridSearchHit {
  chunkId: string;
  scope: ChunkScope;
  content: string;
  /** Combinado, 0..1 (ou um pouco acima por arredondamento) — o que ordena e corta pelo limiar. */
  score: number;
  /** Similaridade de cosseno, 0..1. `null` quando o chunk não tinha vetor OU a busca não tinha vetor de consulta. */
  vectorScore: number | null;
  /** `ts_rank` normalizado, 0..1. `null` quando o termo não casou lexicalmente neste chunk. */
  lexicalScore: number | null;
  origin: ChunkOrigin;
}

export interface HybridSearchResult {
  query: string;
  hits: HybridSearchHit[];
  /**
   * `false` quando o provider de embedding não respondeu (RN-233) — a busca
   * degradou para só léxico, e é isso que diz à UI para avisar em vez de
   * fingir que a metade semântica rodou.
   */
  vectorAvailable: boolean;
  vectorUnavailableReason?: string;
}
