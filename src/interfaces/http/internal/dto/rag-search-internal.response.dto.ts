import { ApiProperty } from '@nestjs/swagger';

/**
 * `POST /internal/rag/search` — contrato fechado com o engine, PROJEÇÃO de
 * `HybridSearchResult` (`domain/rag/rag-citation.ts`) para o formato que a
 * tool `rag_search` do engine espera. Não é `Wire<HybridSearchResult>`: o
 * shape é deliberadamente mais simples (`path`/`chunk`/`excerpt` em vez de
 * `origin`/`chunkId`/`vectorScore`/`lexicalScore`) — ver
 * `internal-rag.controller.ts` para a projeção.
 */
export class RagSearchInternalHitResponseDto {
  @ApiProperty({
    example: 'docs/adr/0080-chat-rag-pipeline-indexacao.md',
    description:
      'File path (`docs`/`adr` scopes) or `session:<id>` (`session` scope, no real file path).',
  })
  path!: string;

  @ApiProperty({ description: 'The full content of the retrieved chunk.' })
  chunk!: string;

  @ApiProperty({
    description: 'Combined score (vector + lexical), already filtered by the threshold.',
  })
  score!: number;

  @ApiProperty({
    description:
      "Short preview of the chunk, for display without blowing up the model's context.",
  })
  excerpt!: string;
}

export class RagSearchInternalResponseDto {
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
