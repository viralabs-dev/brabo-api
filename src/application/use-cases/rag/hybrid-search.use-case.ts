import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  ChunkRepository,
  type Chunk,
  type ChunkScope,
} from '../../ports/chunk-repository.port';
import { RagTelemetryRepository } from '../../ports/rag-telemetry-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { RagEmbeddingService } from './rag-embedding.service';
import type { Actor } from '../../../domain/sessions/session-event.entity';
import {
  origemDoChunk,
  type HybridSearchHit,
  type HybridSearchResult,
} from '../../../domain/rag/rag-citation';
import {
  pesosVigentes,
  type RagSearchHitTelemetry,
} from '../../../domain/rag/rag-telemetry';
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
  /**
   * Quem buscou. Ausente = a chamada não soube dizer, e a telemetria registra
   * o ator `system` em vez de inventar um usuário — mentir sobre o ator seria
   * pior que admitir que não se sabe.
   */
  actor?: Actor;
  /**
   * A sessão, quando há uma. `null`/ausente é o caminho da ABA (busca de
   * projeto) — e é o caso que impede a telemetria de ser só evento de sessão,
   * porque `session_events.session_id` é `NOT NULL`.
   */
  sessionId?: string | null;
}

const QUERY_MIN = 2;
const QUERY_MAX = 500;

const ATOR_DESCONHECIDO: Actor = { kind: 'system', id: 'rag-search' };

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
 *
 * ## O rastro (RN-479)
 *
 * Toda busca grava uma linha em `rag_searches` com os pesos CONGELADOS do
 * momento. É o que destrava a calibração dos quatro números que
 * `rag-search-limits.ts` declara serem chute inicial — sem rastro, calibrar
 * seria trocar um chute por outro.
 *
 * Gravar o rastro NUNCA derruba a busca: quem pergunta não deveria perder a
 * resposta porque o instrumento de medição falhou. Mas também não falha
 * CALADO — a falha vira log com a origem classificada (`infra`), e
 * `searchId: null` na resposta diz à UI que não há a que anexar voto. Os dois
 * lados da mesma regra do repositório: degradar sim, esconder não.
 */
@Injectable()
export class HybridSearchUseCase {
  private readonly logger = new Logger(HybridSearchUseCase.name);

  constructor(
    private readonly chunks: ChunkRepository,
    private readonly embeddings: RagEmbeddingService,
    private readonly telemetry: RagTelemetryRepository,
    private readonly eventos: AppendSessionEventUseCase,
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

    // O relógio cobre a BUSCA, não a validação nem a gravação da telemetria:
    // medir o instrumento junto com o medido faria a latência subir quando a
    // medição ficasse mais cara, e ninguém saberia por quê.
    const comecou = Date.now();

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

    const latencyMs = Date.now() - comecou;

    const searchId = await this.registrarBusca(input, {
      query,
      limit,
      hits,
      available,
      latencyMs,
    });

    return {
      query,
      searchId,
      hits,
      vectorAvailable: available,
      vectorUnavailableReason: available ? undefined : reason,
    };
  }

  /**
   * Grava a linha de `rag_searches` e, SÓ quando há sessão, narra `rag.search`
   * na timeline.
   *
   * A TABELA é a fonte da medição; o evento é NARRAÇÃO. Nunca inverta os dois:
   * medir pelo evento perderia toda busca vinda da aba, que é de projeto e não
   * tem sessão — e são justamente essas que carregam julgamento humano.
   *
   * Devolve `null` quando a gravação falhou. Nada aqui lança: a busca já
   * aconteceu e a resposta é do usuário, não do instrumento.
   */
  private async registrarBusca(
    input: HybridSearchInput,
    medida: {
      query: string;
      limit: number;
      hits: HybridSearchHit[];
      available: boolean;
      latencyMs: number;
    },
  ): Promise<string | null> {
    const ator = input.actor ?? ATOR_DESCONHECIDO;
    const sessionId = input.sessionId ?? null;
    const hitsTelemetria: RagSearchHitTelemetry[] = medida.hits.map(
      (hit, i) => ({
        chunkId: hit.chunkId,
        score: hit.score,
        vectorScore: hit.vectorScore,
        lexicalScore: hit.lexicalScore,
        rank: i + 1,
      }),
    );

    let searchId: string | null = null;
    try {
      const registro = await this.telemetry.recordSearch({
        projectId: input.projectId,
        sessionId,
        actorKind: ator.kind,
        actorId: ator.id,
        query: medida.query,
        topK: medida.limit,
        hits: hitsTelemetria,
        degraded: !medida.available,
        vectorAvailable: medida.available,
        pesos: pesosVigentes(),
        latencyMs: medida.latencyMs,
      });
      searchId = registro.id;
    } catch (erro) {
      // Origem classificada, nunca diagnóstico por eliminação (ADR 0020): o
      // que falha aqui é o INSERT, e isso é infra.
      this.logger.error(
        `[origem: infra] telemetria de busca do RAG não foi gravada para o projeto ${input.projectId}: ${mensagem(erro)}`,
      );
      return null;
    }

    if (!sessionId) return searchId;

    try {
      await this.eventos.execute(input.projectId, sessionId, {
        // Literal, nunca constante: o inventário de `docs/reference/events.md`
        // é gerado por grep de `type: '<x>.<y>'` sobre o código da api, e um
        // tipo atrás de constante fica invisível para ele (ver o comentário em
        // `domain/rag/rag-telemetry.ts`).
        type: 'rag.search',
        actor: ator,
        payload: {
          searchId,
          query: medida.query,
          topK: medida.limit,
          hits: hitsTelemetria.length,
          degraded: !medida.available,
          chunkIds: hitsTelemetria.map((h) => h.chunkId),
        },
      });
    } catch (erro) {
      this.logger.error(
        `[origem: infra] narração \`rag.search\` não foi gravada na sessão ${sessionId}: ${mensagem(erro)}`,
      );
    }

    return searchId;
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

function mensagem(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}
