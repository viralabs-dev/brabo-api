import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { ChunkScope } from '../../../../application/ports/chunk-repository.port';
import {
  RAG_LOCAL_FILE_BYTES_LIMIT,
  RAG_LOCAL_FILE_COUNT_LIMIT,
  RAG_SEARCH_RESULT_LIMIT,
} from '../../../../domain/rag/rag-search-limits';

const ESCOPOS: ChunkScope[] = ['docs', 'adr', 'session', 'local'];

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
    description: 'When absent, searches all four scopes (RN-219/454).',
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

/**
 * One file already read by the BROWSER (`File.text()`, `webkitRelativePath`)
 * — never a host path (RN-455, ADR 0113). `content` is plain UTF-8 text, not
 * base64, to avoid the ~33% transport inflation for what is reference text,
 * not binary. `MaxLength` on `content` is a structural pre-check (roughly
 * `RAG_LOCAL_FILE_BYTES_LIMIT` chars, a safe upper bound for UTF-8 where a
 * character is at most 4 bytes) — the exact byte-accurate caps (per-file AND
 * summed) are enforced in `IndexLocalFolderUseCase`, which is the only place
 * that can see the whole batch at once.
 */
export class LocalFolderFileDto {
  @ApiProperty({
    example: 'src/domain/rag/chunking.ts',
    description:
      'Relative path within the chosen folder — never absolute, never `..`.',
  })
  @IsString()
  @MaxLength(1024)
  path!: string;

  @ApiProperty({ description: 'Plain UTF-8 text — never base64.' })
  @IsString()
  @MaxLength(RAG_LOCAL_FILE_BYTES_LIMIT)
  content!: string;
}

/** O corpo de `POST /projects/:projectId/rag/local` (RN-455, ADR 0113). */
export class AttachLocalFolderRequestDto {
  @ApiProperty({
    example: 'brabo',
    description:
      'The folder name as chosen in the browser — shown in the coverage panel.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  folderName!: string;

  @ApiProperty({
    type: [LocalFolderFileDto],
    description: `Up to ${RAG_LOCAL_FILE_COUNT_LIMIT} files. The exact summed-byte cap (RAG_LOCAL_TOTAL_BYTES_LIMIT) and the per-file extension allowlist are enforced by the use case, not by this DTO — an array of individually-valid strings can still add up to a payload too large.`,
  })
  @IsArray()
  @ArrayMaxSize(RAG_LOCAL_FILE_COUNT_LIMIT)
  @ValidateNested({ each: true })
  @Type(() => LocalFolderFileDto)
  files!: LocalFolderFileDto[];
}
