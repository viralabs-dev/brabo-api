import { ApiProperty } from '@nestjs/swagger';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';
import type { ChunkScope } from '../../../../application/ports/chunk-repository.port';
import type {
  ChunkOrigin,
  HybridSearchHit,
  HybridSearchResult,
} from '../../../../domain/rag/rag-citation';
import {
  RAG_VERDICTS,
  type RagVerdict,
} from '../../../../domain/rag/rag-telemetry';
import type { RagFeedbackReport } from '../../../../application/use-cases/rag/record-rag-feedback.use-case';
import type { IndexDocsReport } from '../../../../application/use-cases/rag/index-project-docs.use-case';
import type { IndexSessionReport } from '../../../../application/use-cases/rag/index-session.use-case';
import type { IndexLocalFolderReport } from '../../../../application/use-cases/rag/index-local-folder.use-case';
import type { ReindexProjectReport } from '../../../../application/use-cases/rag/reindex-project.use-case';
import type {
  RagCoverage,
  RagFileCoverage,
  RagLocalCoverage,
  RagSessionCoverage,
} from '../../../../application/use-cases/rag/get-rag-coverage.use-case';

/**
 * Respostas do pipeline de indexação e da busca híbrida do Chat RAG
 * (PROGRAMA 28, Onda 4, frente G2 — RN-231..234, ADR 0080; RN-455/ADR 0113
 * ampliou pra `local`).
 */

const ESCOPOS = ['docs', 'adr', 'session', 'local'] as const;

// -------------------------------------------------------------- busca

export class HybridSearchHitResponseDto implements Wire<HybridSearchHit> {
  @ApiProperty() chunkId!: string;

  @ApiProperty({ enum: ESCOPOS }) scope!: ChunkScope;

  @ApiProperty() content!: string;

  @ApiProperty({
    description:
      'Combined (RAG_SEARCH_WEIGHT_VECTOR*vector + RAG_SEARCH_WEIGHT_LEXICAL*lexical), ' +
      'already filtered by the threshold — every returned hit has passed it.',
  })
  score!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Cosine similarity, 0..1. `null` when this chunk had no vector.',
  })
  vectorScore!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Normalized `ts_rank`, 0..1. `null` when the term did not match in this chunk.',
  })
  lexicalScore!: number | null;

  @ApiProperty({
    type: Object,
    additionalProperties: true,
    description:
      'Discriminated union by `kind`: "file" (`sourcePath`/`headingPath`) or ' +
      '"session" (`sessionId`/`eventId`). See `domain/rag/rag-citation.ts`.',
  })
  origin!: ChunkOrigin;
}
export const _chavesHit: MesmasChaves<
  HybridSearchHitResponseDto,
  Wire<HybridSearchHit>
> = true;

export class HybridSearchResponseDto implements Wire<HybridSearchResult> {
  @ApiProperty() query!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'uuid',
    description:
      'The `rag_searches` row this search left (RN-479) — the id a vote attaches to. ' +
      '`null` means the telemetry row was NOT written (the insert failed), which is not ' +
      'the same as "no results": there is nothing to attach a vote to, and the UI needs ' +
      'the two apart so it does not offer a control the api will refuse.',
  })
  searchId!: string | null;

  @ApiProperty({ type: [HybridSearchHitResponseDto] })
  hits!: HybridSearchHitResponseDto[];

  @ApiProperty({
    description:
      '`false` when the embedding provider did not respond — the search ran ' +
      'with only the lexical signal (RN-233).',
  })
  vectorAvailable!: boolean;

  @ApiProperty({ required: false })
  vectorUnavailableReason?: string;
}
export const _chavesResultado: MesmasChaves<
  HybridSearchResponseDto,
  Wire<HybridSearchResult>
> = true;

/** A resposta de `POST .../rag/feedback` (RN-480). */
export class RagFeedbackResponseDto implements Wire<RagFeedbackReport> {
  @ApiProperty({ format: 'uuid' }) searchId!: string;
  @ApiProperty({ format: 'uuid' }) chunkId!: string;
  @ApiProperty({ enum: RAG_VERDICTS }) verdict!: RagVerdict;
  @ApiProperty({
    description:
      'The 1-based position the judged chunk held in THAT search — the number that separates ' +
      '"the index is poor" from "the weights are wrong".',
  })
  rank!: number;
}
export const _chavesFeedback: MesmasChaves<
  RagFeedbackResponseDto,
  Wire<RagFeedbackReport>
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

/** A resposta de `POST .../rag/local` (RN-455, ADR 0113). */
export class AttachLocalFolderResponseDto implements Wire<IndexLocalFolderReport> {
  @ApiProperty() folderName!: string;
  @ApiProperty() filesIndexed!: number;
  @ApiProperty({
    description:
      'Skipped for being over the per-file byte cap or having an unrecognized extension — never fails the whole batch.',
  })
  filesSkipped!: number;
  @ApiProperty() chunksCreated!: number;
  @ApiProperty({ type: IndexEmbeddingResponseDto })
  embedding!: IndexEmbeddingResponseDto;
}
export const _chavesAttachLocalFolder: MesmasChaves<
  AttachLocalFolderResponseDto,
  Wire<IndexLocalFolderReport>
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

export class RagLocalCoverageResponseDto implements Wire<RagLocalCoverage> {
  @ApiProperty() filesIndexed!: number;
  @ApiProperty({ type: String, nullable: true }) folderName!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Real `MAX(chunks.created_at)` for this scope — never a guessed "N minutes ago" (RN-455).',
  })
  lastAttachedAt!: string | null;
}
export const _chavesLocalCoverage: MesmasChaves<
  RagLocalCoverageResponseDto,
  Wire<RagLocalCoverage>
> = true;

export class RagCoverageResponseDto implements Wire<RagCoverage> {
  @ApiProperty({ type: RagFileCoverageResponseDto })
  docs!: RagFileCoverageResponseDto;
  @ApiProperty({ type: RagFileCoverageResponseDto })
  adr!: RagFileCoverageResponseDto;
  @ApiProperty({ type: RagSessionCoverageResponseDto })
  session!: RagSessionCoverageResponseDto;
  @ApiProperty({ type: RagLocalCoverageResponseDto })
  local!: RagLocalCoverageResponseDto;
  @ApiProperty() chunksTotal!: number;
  @ApiProperty() chunksWithoutVector!: number;
}
export const _chavesCoverage: MesmasChaves<
  RagCoverageResponseDto,
  Wire<RagCoverage>
> = true;
