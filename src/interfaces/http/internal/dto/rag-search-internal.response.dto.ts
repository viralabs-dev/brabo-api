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
      'Caminho do arquivo (escopos `docs`/`adr`) ou `session:<id>` (escopo `session`, sem caminho de arquivo real).',
  })
  path!: string;

  @ApiProperty({ description: 'O conteúdo completo do chunk recuperado.' })
  chunk!: string;

  @ApiProperty({
    description: 'Score combinado (vetor + léxico), já filtrado pelo limiar.',
  })
  score!: number;

  @ApiProperty({
    description:
      'Prévia curta do chunk, para exibição sem estourar o contexto do modelo.',
  })
  excerpt!: string;
}

export class RagSearchInternalResponseDto {
  @ApiProperty({ type: [RagSearchInternalHitResponseDto] })
  hits!: RagSearchInternalHitResponseDto[];

  @ApiProperty({
    description:
      '`true` quando o embedding da CONSULTA não estava disponível e a busca ' +
      'caiu para léxico-only (mesma semântica de `vectorAvailable: false` do ' +
      '`HybridSearchUseCase`).',
  })
  degraded!: boolean;
}
