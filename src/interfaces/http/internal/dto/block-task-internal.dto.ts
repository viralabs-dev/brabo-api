import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import {
  FAILURE_ORIGINS,
  type FailureOrigin,
} from '../../../../domain/agents/failure-origin';

export class BlockTaskInternalDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({ example: 'dev-api' })
  @IsString()
  agentId!: string;

  @ApiProperty({ example: 'Gate correction cap reached.' })
  @IsString()
  reason!: string;

  @ApiProperty({
    example: 'Correction cycle exhausted without exit 0.',
    description:
      'Free-text diagnosis — a human detail of what happened, not the structured origin of the failure.',
  })
  @IsString()
  diagnosis!: string;

  @ApiPropertyOptional({
    enum: FAILURE_ORIGINS,
    example: 'infra',
    description:
      'The ORIGIN of the failure: `infra`, `modelo`, `codigo`, or `politica`. Never by elimination — this is the lesson ' +
      'from ADR 0020, taken up a level by the QA Lead in ADR 0038. Optional: not every call site knows the origin.',
  })
  @IsOptional()
  @IsIn(FAILURE_ORIGINS)
  origin?: FailureOrigin;
}
