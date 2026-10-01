import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsString, IsUUID, MinLength } from 'class-validator';
import { StoryResponseDto } from '../../backlog/dto/backlog.response.dto';

/**
 * Corpo de `POST /internal/sessions/:sessionId/semantic-duplicate-check`
 * (RN-681, ADR 0198). Só `business_rule` passa por aqui: a regra é gravada
 * pelo engine como evento, e a história é checada dentro da própria criação.
 */
export class SemanticDuplicateCheckInternalDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({ enum: ['business_rule'], example: 'business_rule' })
  @IsIn(['business_rule'])
  kind!: 'business_rule';

  @ApiProperty({
    example: 'Greeting with the caller name',
    description:
      'Title of the rule JUST appended. Rules with the same normalized title (RN-080 makes it ' +
      'the new one) are left out of the comparison.',
  })
  @IsString()
  @MinLength(1)
  title!: string;
}

export class SemanticDuplicateSimilarDto {
  @ApiProperty({ example: '01JC4Z0000HISTORIA000000001' })
  id!: string;

  @ApiProperty({ example: 'Deterministic public greeting endpoint' })
  title!: string;

  @ApiPropertyOptional({ example: 0.83 })
  similarity?: number;
}

export class SemanticDuplicateCheckResponseDto {
  @ApiProperty({
    enum: ['warned', 'clean', 'skipped', 'nothing_to_compare'],
    description:
      '`warned` NEVER blocks: the item was already written. `skipped` carries the reason — ' +
      'no embedding provider, daemon down, the 10 s ceiling — and is also narrated in the event log.',
  })
  status!: 'warned' | 'clean' | 'skipped' | 'nothing_to_compare';

  @ApiPropertyOptional({ type: SemanticDuplicateSimilarDto })
  similarTo?: SemanticDuplicateSimilarDto;

  @ApiPropertyOptional({ type: SemanticDuplicateSimilarDto, nullable: true })
  closest?: SemanticDuplicateSimilarDto | null;

  @ApiPropertyOptional({ example: 0.83 })
  similarity?: number;

  @ApiPropertyOptional({
    example: 0.8,
    description:
      'Cosine threshold — a STARTING POINT, not calibrated (ADR 0198).',
  })
  threshold?: number;

  @ApiPropertyOptional({
    example: 12,
    description:
      'How many existing items were compared (the most recent, up to 100).',
  })
  compared?: number;

  @ApiPropertyOptional({
    example: 12,
    description: 'How many exist in the project.',
  })
  total?: number;

  @ApiPropertyOptional({ example: 'provider "ollama" did not answer' })
  reason?: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'The sentence the agent reads in the tool result; `null` when there is nothing to say.',
  })
  message!: string | null;
}

/** A história criada + o desfecho da checagem semântica (RN-681). */
export class CreatedStoryResponseDto extends StoryResponseDto {
  @ApiProperty({ type: SemanticDuplicateCheckResponseDto })
  semanticDuplicate!: SemanticDuplicateCheckResponseDto;
}
