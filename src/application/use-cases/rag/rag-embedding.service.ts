import { Injectable, Logger } from '@nestjs/common';
import { LLMProviderRegistry } from '../../ports/llm-provider-registry.port';
import { LLMProviderError } from '../../../domain/llm/llm-provider-errors';
import {
  RAG_EMBEDDING_MODEL,
  RAG_EMBEDDING_PROVIDER,
  RAG_EMBED_BATCH_SIZE,
} from '../../../domain/rag/rag-search-limits';

export interface EmbedManyResult {
  /** Um vetor por entrada, na MESMA ordem. `null` quando não foi possível vetorizar. */
  vectors: (number[] | null)[];
  /** `false` quando o provider de embedding falhou — ver RN-233. */
  available: boolean;
  reason?: string;
}

export interface EmbedQueryResult {
  vector: number[] | null;
  available: boolean;
  reason?: string;
}

/**
 * O ponto ÚNICO por onde o pipeline de indexação e a busca híbrida chamam
 * `LLMProvider.embed` (PROGRAMA 28, Onda 4 — RN-233, ADR 0080).
 *
 * ## Por que provider e modelo são FIXOS, não resolvidos por catálogo
 *
 * `chunks.embedding` é `vector(768)` — dimensão fixa no schema, documentada
 * como sendo a de `nomic-embed-text` (RN-222). Um catálogo de modelo de
 * embedding por projeto exigiria uma coluna persistida
 * (`ModeloDoCatalogo.supportsEmbeddings` ainda não tem equivalente em
 * `models`, ver `domain/llm/embedding-capability.ts`) e uma migração que
 * esta onda não tem slot para — `project_containers` (0046) é a única desta
 * onda, e é da frente F1. Resolver dinamicamente sem essa coluna seria
 * inventar uma fonte de verdade que não existe.
 *
 * ## Por que FALHA HONESTA, não silêncio
 *
 * Quando o provider (hoje só `ollama` declara `capabilities.embeddings`,
 * RN-191) não responde — daemon fora do ar, timeout, modelo não puxado —
 * este serviço NÃO lança para o chamador tratar chunk a chunk. Ele degrada:
 * devolve `available: false` e um vetor `null` por entrada. O pipeline de
 * indexação usa isso para gravar os chunks SEM vetor (léxico continua
 * disponível via `search_vector`, que é `GENERATED ALWAYS AS` e não depende
 * de provider nenhum) em vez de falhar a indexação inteira por uma falha que
 * só atinge metade do que a tabela guarda. A busca usa o mesmo sinal para
 * degradar para léxico-only e AVISAR (nunca fingir que rodou o híbrido
 * completo).
 */
@Injectable()
export class RagEmbeddingService {
  private readonly logger = new Logger(RagEmbeddingService.name);

  constructor(private readonly providers: LLMProviderRegistry) {}

  async embedMany(texts: readonly string[]): Promise<EmbedManyResult> {
    if (texts.length === 0) return { vectors: [], available: true };

    const provider = this.providers.get(RAG_EMBEDDING_PROVIDER);
    if (!provider.capabilities.embeddings || !provider.embed) {
      return {
        vectors: texts.map(() => null),
        available: false,
        reason: `provider "${RAG_EMBEDDING_PROVIDER}" não declara a capability embeddings`,
      };
    }

    const vetores: (number[] | null)[] = [];
    for (
      let inicio = 0;
      inicio < texts.length;
      inicio += RAG_EMBED_BATCH_SIZE
    ) {
      const lote = texts.slice(inicio, inicio + RAG_EMBED_BATCH_SIZE);
      try {
        const resultado = await provider.embed(lote, {
          model: RAG_EMBEDDING_MODEL,
        });
        for (const vetor of resultado.vectors) vetores.push([...vetor]);
      } catch (erro) {
        const motivo = descreverErro(erro);
        this.logger.warn(
          `embedding indisponível a partir do lote iniciado em ${inicio}: ${motivo}`,
        );
        // A falha costuma ser sistêmica (daemon fora do ar, ou modelo não
        // puxado) — repetir lote a lote só multiplicaria o timeout. O
        // restante deste lote e de todos os seguintes fica sem vetor.
        for (let i = inicio; i < texts.length; i++) vetores.push(null);
        return { vectors: vetores, available: false, reason: motivo };
      }
    }
    return { vectors: vetores, available: true };
  }

  async embedQuery(text: string): Promise<EmbedQueryResult> {
    const resultado = await this.embedMany([text]);
    return {
      vector: resultado.vectors[0] ?? null,
      available: resultado.available,
      reason: resultado.reason,
    };
  }
}

function descreverErro(erro: unknown): string {
  if (erro instanceof LLMProviderError) return `${erro.code}: ${erro.message}`;
  if (erro instanceof Error) return erro.message;
  return 'erro desconhecido';
}
