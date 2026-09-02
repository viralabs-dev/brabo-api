import { ApiProperty } from '@nestjs/swagger';
import {
  RAG_VERDICTS,
  type RagVerdict,
} from '../../../../domain/rag/rag-telemetry';

/**
 * `POST /internal/rag/search` — contrato fechado com o engine, PROJEÇÃO de
 * `HybridSearchResult` (`domain/rag/rag-citation.ts`) para o formato que a
 * tool `rag_search` do engine espera. Não é `Wire<HybridSearchResult>`: o
 * shape é deliberadamente mais simples (`path`/`chunk`/`excerpt` em vez de
 * `origin`/`vectorScore`/`lexicalScore`) — ver `internal-rag.controller.ts`
 * para a projeção.
 *
 * `chunkId` é a ÚNICA exceção a essa simplificação, e ela tem motivo: sem o
 * par `searchId`/`chunkId` o agente não teria como votar num trecho
 * (`rag_feedback`, RN-480), e o feedback do agente seria uma ferramenta sem
 * referência a que apontar.
 */
export class RagSearchInternalHitResponseDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'The chunk id — half of the reference a `rag_feedback` vote needs (RN-480). Without it ' +
      'the agent could read a hit and have no way to say it was useful.',
  })
  chunkId!: string;

  @ApiProperty({
    example: 'docs/adr/0080-chat-rag-pipeline-indexacao.md',
    description:
      'File path (`docs`/`adr` scopes) or `session:<id>` (`session` scope, no real file path).',
  })
  path!: string;

  @ApiProperty({ description: 'The full content of the retrieved chunk.' })
  chunk!: string;

  @ApiProperty({
    description:
      'Combined score (vector + lexical), already filtered by the threshold.',
  })
  score!: number;

  @ApiProperty({
    description:
      "Short preview of the chunk, for display without blowing up the model's context.",
  })
  excerpt!: string;
}

export class RagSearchInternalResponseDto {
  @ApiProperty({
    type: String,
    nullable: true,
    format: 'uuid',
    description:
      'The `rag_searches` row this search left (RN-479) — the other half of the vote reference. ' +
      '`null` when the telemetry row was not written; the tool then omits the ids instead of ' +
      'offering the model a reference that would be refused.',
  })
  searchId!: string | null;

  @ApiProperty({ type: [RagSearchInternalHitResponseDto] })
  hits!: RagSearchInternalHitResponseDto[];

  @ApiProperty({
    description:
      '`true` when the QUERY embedding was not available and the search ' +
      'fell back to lexical-only (same semantics as `vectorAvailable: false` ' +
      'from `HybridSearchUseCase`).',
  })
  degraded!: boolean;
}

/**
 * `POST /internal/rag/feedback` — a resposta do voto do agente (RN-480).
 *
 * `rank` volta de propósito: é a informação que o modelo NÃO tinha e que o
 * servidor tem, e é ela que separa "o índice está pobre" de "os pesos estão
 * errados". Devolver só `ok: true` desperdiçaria a única coisa útil a dizer.
 */
export class RagFeedbackInternalResponseDto {
  @ApiProperty({ format: 'uuid' })
  searchId!: string;

  @ApiProperty({ format: 'uuid' })
  chunkId!: string;

  @ApiProperty({ enum: RAG_VERDICTS })
  verdict!: RagVerdict;

  @ApiProperty({
    description: 'The 1-based position the judged chunk held in THAT search.',
  })
  rank!: number;
}
