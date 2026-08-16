import { ApiProperty } from '@nestjs/swagger';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';
import type { ChunkScope } from '../../../../application/ports/chunk-repository.port';
import type {
  ChunkOrigin,
  HybridSearchHit,
  HybridSearchResult,
} from '../../../../domain/rag/rag-citation';
import type { IndexDocsReport } from '../../../../application/use-cases/rag/index-project-docs.use-case';
import type { IndexSessionReport } from '../../../../application/use-cases/rag/index-session.use-case';
import type { ReindexProjectReport } from '../../../../application/use-cases/rag/reindex-project.use-case';
import type {
  RagCoverage,
  RagFileCoverage,
  RagSessionCoverage,
} from '../../../../application/use-cases/rag/get-rag-coverage.use-case';

/**
 * Respostas do pipeline de indexação e da busca híbrida do Chat RAG
 * (PROGRAMA 28, Onda 4, frente G2 — RN-231..234, ADR 0080).
 */

const ESCOPOS = ['docs', 'adr', 'session'] as const;

// -------------------------------------------------------------- busca

export class HybridSearchHitResponseDto implements Wire<HybridSearchHit> {
  @ApiProperty() chunkId!: string;

  @ApiProperty({ enum: ESCOPOS }) scope!: ChunkScope;

  @ApiProperty() content!: string;

  @ApiProperty({
    description:
      'Combinado (RAG_SEARCH_WEIGHT_VECTOR*vetor + RAG_SEARCH_WEIGHT_LEXICAL*léxico), ' +
      'já filtrado pelo limiar — todo hit devolvido passou dele.',
  })
  score!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Similaridade de cosseno, 0..1. `null` quando este chunk não tinha vetor.',
  })
  vectorScore!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      '`ts_rank` normalizado, 0..1. `null` quando o termo não casou neste chunk.',
  })
  lexicalScore!: number | null;

  @ApiProperty({
    type: Object,
    additionalProperties: true,
    description:
      'União discriminada por `kind`: "file" (`sourcePath`/`headingPath`) ou ' +
      '"session" (`sessionId`/`eventId`). Ver `domain/rag/rag-citation.ts`.',
  })
  origin!: ChunkOrigin;
}
export const _chavesHit: MesmasChaves<
  HybridSearchHitResponseDto,
  Wire<HybridSearchHit>
> = true;

export class HybridSearchResponseDto implements Wire<HybridSearchResult> {
  @ApiProperty() query!: string;

  @ApiProperty({ type: [HybridSearchHitResponseDto] })
  hits!: HybridSearchHitResponseDto[];

  @ApiProperty({
    description:
      '`false` quando o provider de embedding não respondeu — a busca rodou ' +
      'só com o sinal léxico (RN-233).',
  })
  vectorAvailable!: boolean;

  @ApiProperty({ required: false })
  vectorUnavailableReason?: string;
}
export const _chavesResultado: MesmasChaves<
  HybridSearchResponseDto,
  Wire<HybridSearchResult>
> = true;

// -------------------------------------------------------------- indexação

export class IndexEmbeddingResponseDto implements Wire<
  IndexDocsReport['embedding']
> {
  @ApiProperty() available!: boolean;
  @ApiProperty() embedded!: number;
  @ApiProperty() skipped!: number;
  @ApiProperty({ required: false }) reason?: string;
}
export const _chavesEmbedding: MesmasChaves<
  IndexEmbeddingResponseDto,
  Wire<IndexDocsReport['embedding']>
> = true;

export class IndexDocsReportResponseDto implements Wire<IndexDocsReport> {
  @ApiProperty() filesScanned!: number;
  @ApiProperty() docsChunks!: number;
  @ApiProperty() adrChunks!: number;
  @ApiProperty() truncated!: boolean;
  @ApiProperty({ type: IndexEmbeddingResponseDto })
  embedding!: IndexEmbeddingResponseDto;
}
export const _chavesIndexDocs: MesmasChaves<
  IndexDocsReportResponseDto,
  Wire<IndexDocsReport>
> = true;

export class ReindexSessionsResponseDto implements Wire<
  ReindexProjectReport['sessions']
> {
  @ApiProperty() total!: number;
  @ApiProperty() indexed!: number;
  @ApiProperty() chunksCreated!: number;
}
export const _chavesReindexSessions: MesmasChaves<
  ReindexSessionsResponseDto,
  Wire<ReindexProjectReport['sessions']>
> = true;

export class ReindexProjectResponseDto implements Wire<ReindexProjectReport> {
  @ApiProperty({ type: IndexDocsReportResponseDto })
  docs!: IndexDocsReportResponseDto;
  @ApiProperty({ type: ReindexSessionsResponseDto })
  sessions!: ReindexSessionsResponseDto;
  @ApiProperty() embeddingAvailable!: boolean;
  @ApiProperty({ required: false }) embeddingReason?: string;
}
export const _chavesReindex: MesmasChaves<
  ReindexProjectResponseDto,
  Wire<ReindexProjectReport>
> = true;

/** Não exposta por rota própria hoje — exportada para o teste de tipo cobrir o shape. */
export class IndexSessionReportResponseDto implements Wire<IndexSessionReport> {
  @ApiProperty() eventsScanned!: number;
  @ApiProperty() chunksCreated!: number;
  @ApiProperty({ type: IndexEmbeddingResponseDto })
  embedding!: IndexEmbeddingResponseDto;
}
export const _chavesIndexSession: MesmasChaves<
  IndexSessionReportResponseDto,
  Wire<IndexSessionReport>
> = true;

// -------------------------------------------------------------- cobertura

export class RagFileCoverageResponseDto implements Wire<RagFileCoverage> {
  @ApiProperty() filesInRepo!: number;
  @ApiProperty() filesIndexed!: number;
  @ApiProperty() truncated!: boolean;
}
export const _chavesFileCoverage: MesmasChaves<
  RagFileCoverageResponseDto,
  Wire<RagFileCoverage>
> = true;

export class RagSessionCoverageResponseDto implements Wire<RagSessionCoverage> {
  @ApiProperty() sessionsInProject!: number;
  @ApiProperty() sessionsIndexed!: number;
}
export const _chavesSessionCoverage: MesmasChaves<
  RagSessionCoverageResponseDto,
  Wire<RagSessionCoverage>
> = true;

export class RagCoverageResponseDto implements Wire<RagCoverage> {
  @ApiProperty({ type: RagFileCoverageResponseDto })
  docs!: RagFileCoverageResponseDto;
  @ApiProperty({ type: RagFileCoverageResponseDto })
  adr!: RagFileCoverageResponseDto;
  @ApiProperty({ type: RagSessionCoverageResponseDto })
  session!: RagSessionCoverageResponseDto;
  @ApiProperty() chunksTotal!: number;
  @ApiProperty() chunksWithoutVector!: number;
}
export const _chavesCoverage: MesmasChaves<
  RagCoverageResponseDto,
  Wire<RagCoverage>
> = true;
