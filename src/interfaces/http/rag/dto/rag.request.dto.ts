import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import type { ChunkScope } from '../../../../application/ports/chunk-repository.port';
import { RAG_SEARCH_RESULT_LIMIT } from '../../../../domain/rag/rag-search-limits';

const ESCOPOS: ChunkScope[] = ['docs', 'adr', 'session'];

/** O corpo de `POST /projects/:projectId/rag/search` (RN-234, ADR 0080). */
export class HybridSearchRequestDto {
  @ApiProperty({
    example: 'como funciona o gate de PR',
    description: 'Entre 2 e 500 caracteres — mesma régua da busca da aba Code.',
  })
  @IsString()
  query!: string;

  @ApiProperty({
    required: false,
    enum: ESCOPOS,
    isArray: true,
    description: 'Ausente busca nos três escopos (RN-219).',
  })
  @IsOptional()
  @IsArray()
  @IsIn(ESCOPOS, { each: true })
  scopes?: ChunkScope[];

  @ApiProperty({
    required: false,
    example: RAG_SEARCH_RESULT_LIMIT,
    description: `1 a ${RAG_SEARCH_RESULT_LIMIT} — ausente usa o teto.`,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(RAG_SEARCH_RESULT_LIMIT)
  limit?: number;
}
