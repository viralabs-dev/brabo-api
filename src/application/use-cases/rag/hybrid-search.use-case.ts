import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ChunkRepository,
  type Chunk,
  type ChunkScope,
} from '../../ports/chunk-repository.port';
import { RagEmbeddingService } from './rag-embedding.service';
import {
  origemDoChunk,
  type HybridSearchHit,
  type HybridSearchResult,
} from '../../../domain/rag/rag-citation';
import {
  RAG_SEARCH_LEXICAL_CANDIDATES,
  RAG_SEARCH_RESULT_LIMIT,
  RAG_SEARCH_SCORE_THRESHOLD,
  RAG_SEARCH_VECTOR_CANDIDATES,
  RAG_SEARCH_WEIGHT_LEXICAL,
  RAG_SEARCH_WEIGHT_VECTOR,
} from '../../../domain/rag/rag-search-limits';

export interface HybridSearchInput {
  projectId: string;
  query: string;
  scopes?: ChunkScope[];
  limit?: number;
}

const QUERY_MIN = 2;
const QUERY_MAX = 500;

/**
 * A busca híbrida do Chat RAG (PROGRAMA 28, Onda 4 — RN-233/234, ADR 0080):
 * combina similaridade de cosseno (pgvector, índice HNSW) com `ts_rank`
 * léxico (tsvector, índice GIN), cada um por uma consulta INDEPENDENTE
 * (`ChunkRepository.searchByVector`/`searchByLexicalQuery` — ver ADR 0079
 * para o porquê de não ser um JOIN só), fundidas aqui por soma ponderada.
 *
 * ## Degradação honesta quando o embedding falha (RN-233)
 *
 * Se `RagEmbeddingService` não conseguir vetorizar a CONSULTA (provider
 * indisponível), a busca não lança: continua só com o sinal léxico, e
 * `vectorAvailable: false` no resultado diz isso — a UI (Onda 5) tem o que
 * precisa para avisar "busca semântica indisponível" em vez de silenciar a
 * metade que faltou.
 */
@Injectable()
export class HybridSearchUseCase {
  constructor(
    private readonly chunks: ChunkRepository,
    private readonly embeddings: RagEmbeddingService,
  ) {}

  async execute(input: HybridSearchInput): Promise<HybridSearchResult> {
    const query = input.query?.trim() ?? '';
    if (query.length < QUERY_MIN || query.length > QUERY_MAX) {
      throw new BadRequestException(
        `\`query\` precisa ter entre ${QUERY_MIN} e ${QUERY_MAX} caracteres`,
      );
    }
    const limit = clamp(
      input.limit ?? RAG_SEARCH_RESULT_LIMIT,
      1,
      RAG_SEARCH_RESULT_LIMIT,
    );

    const [{ vector: queryVector, available, reason }, lexicalCandidatos] =
      await Promise.all([
        this.embeddings.embedQuery(query),
        this.chunks.searchByLexicalQuery(input.projectId, query, {
          scope: input.scopes,
          limit: RAG_SEARCH_LEXICAL_CANDIDATES,
        }),
      ]);

    const vectorCandidatos = queryVector
      ? await this.chunks.searchByVector(input.projectId, queryVector, {
          scope: input.scopes,
          limit: RAG_SEARCH_VECTOR_CANDIDATES,
        })
      : [];

    const combinados = new Map<
      string,
      { chunk: Chunk; vectorScore: number | null; lexicalScore: number | null }
    >();
    for (const candidato of vectorCandidatos) {
      combinados.set(candidato.chunk.id, {
        chunk: candidato.chunk,
        vectorScore: candidato.score,
        lexicalScore: null,
      });
    }
    for (const candidato of lexicalCandidatos) {
      const existente = combinados.get(candidato.chunk.id);
      if (existente) existente.lexicalScore = candidato.score;
      else
        combinados.set(candidato.chunk.id, {
          chunk: candidato.chunk,
          vectorScore: null,
          lexicalScore: candidato.score,
        });
    }

    const hits: HybridSearchHit[] = [...combinados.values()]
      .map(({ chunk, vectorScore, lexicalScore }) => ({
        chunkId: chunk.id,
        scope: chunk.scope,
        content: chunk.content,
        vectorScore,
        lexicalScore,
        score:
          RAG_SEARCH_WEIGHT_VECTOR * (vectorScore ?? 0) +
          RAG_SEARCH_WEIGHT_LEXICAL * (lexicalScore ?? 0),
        origin: origemDoChunk(chunk),
      }))
      .filter((hit) => hit.score >= RAG_SEARCH_SCORE_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return {
      query,
      hits,
      vectorAvailable: available,
      vectorUnavailableReason: available ? undefined : reason,
    };
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}
