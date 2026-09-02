import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  RAG_VERDICTS,
  type RagVerdict,
} from '../../../../domain/rag/rag-telemetry';

/** `POST /internal/rag/search` — contrato fechado com o engine (tool `rag_search`). */
export class RagSearchInternalDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({ example: 'how the parallelism cap is decided' })
  @IsString()
  @MinLength(1)
  query!: string;

  @ApiProperty({ required: false, example: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  topK?: number;

  @ApiProperty({
    required: false,
    format: 'uuid',
    description:
      'The session the agent is running in. Absent means the caller had no session — the ' +
      'telemetry row is still written (RN-479), only the `rag.search` timeline narration is ' +
      'skipped. Never invented by the api: a session it did not receive is a session that did not exist.',
  })
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @ApiProperty({
    required: false,
    example: 'dev-lead',
    description:
      'Agent slug, recorded as the telemetry actor (`actor_kind: agent`). Absent falls back to ' +
      'the `system` actor rather than inventing a user.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  agent?: string;
}

/**
 * `POST /internal/rag/feedback` — o voto do AGENTE sobre um trecho (RN-480),
 * contrato fechado com a tool `rag_feedback` do engine.
 *
 * `searchId`/`chunkId` vêm do resultado da PRÓPRIA `rag_search` — o modelo não
 * os inventa, e id desconhecido volta como recusa 400 que o engine converte em
 * tool-result de erro (RN-061), nunca crash.
 */
export class RagFeedbackInternalDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  searchId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  chunkId!: string;

  @ApiProperty({ enum: RAG_VERDICTS })
  @IsIn(RAG_VERDICTS)
  verdict!: RagVerdict;

  @ApiProperty({ example: 'qa', description: 'Agent slug — the voter.' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  agent!: string;
}
