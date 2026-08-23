import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import type { ChunkScope } from '../../../../application/ports/chunk-repository.port';
import { RAG_SEARCH_RESULT_LIMIT } from '../../../../domain/rag/rag-search-limits';

const ESCOPOS: ChunkScope[] = ['docs', 'adr', 'session'];

/** O corpo de `POST /projects/:projectId/rag/search` (RN-234, ADR 0080). */
export class HybridSearchRequestDto {
  @ApiProperty({
    example: 'how does the PR gate work',
    description:
      'Between 2 and 500 characters — same rule as the Code tab search.',
  })
  @IsString()
  query!: string;

  @ApiProperty({
    required: false,
    enum: ESCOPOS,
    isArray: true,
    description: 'When absent, searches all three scopes (RN-219).',
  })
  @IsOptional()
  @IsArray()
  @IsIn(ESCOPOS, { each: true })
  scopes?: ChunkScope[];

  @ApiProperty({
    required: false,
    example: RAG_SEARCH_RESULT_LIMIT,
    description: `1 to ${RAG_SEARCH_RESULT_LIMIT} — when absent, uses the cap.`,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(RAG_SEARCH_RESULT_LIMIT)
  limit?: number;
}
