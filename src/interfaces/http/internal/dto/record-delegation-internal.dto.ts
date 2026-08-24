import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { FAILURE_ORIGINS } from '../../../../domain/agents/failure-origin';

const DELEGATION_STATUSES = ['completed', 'failed', 'dispensed'] as const;

export class RecordDelegationInternalDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({
    example: 'qa',
    description:
      'The area that delegated — "qa" (Phase 8b) or "infra" (Phase 8c). Text, not enum.',
  })
  @IsString()
  area!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '01JC4Z0000TASK00000000001',
    description:
      'The backlog task behind the delegation, when it exists. QA (Phase 8b) always sends it; ' +
      'Infra (Phase 8c) never does — the delegation is about the SESSION, not a task.',
  })
  @IsOptional()
  @IsUUID()
  taskId?: string;

  @ApiProperty({ example: 'qa-lead' })
  @IsString()
  leadAgent!: string;

  @ApiProperty({ example: 'qa-automacao' })
  @IsString()
  subagent!: string;

  @ApiProperty({ enum: DELEGATION_STATUSES, example: 'completed' })
  @IsIn(DELEGATION_STATUSES)
  status!: (typeof DELEGATION_STATUSES)[number];

  @ApiPropertyOptional({
    example: 'evt_01jc4z0000parecer000000001',
    description:
      "Id of the `artifact.qa_verdict` session_event for THIS subspecialty's VERDICT " +
      '— required when `status` is "completed".',
  })
  @IsOptional()
  @IsString()
  parecerArtifactId?: string;

  @ApiPropertyOptional({
    enum: FAILURE_ORIGINS,
    example: 'infra',
    description:
      'The ORIGIN of the failure (ADR 0020/0038), never by elimination — required ' +
      'when `status` is "failed".',
  })
  @IsOptional()
  @IsIn(FAILURE_ORIGINS)
  failureOrigin?: (typeof FAILURE_ORIGINS)[number];

  @ApiPropertyOptional({
    example: 'iteration limit reached without emit_perf_seguranca_verdict',
  })
  @IsOptional()
  @IsString()
  failureReason?: string;

  @ApiPropertyOptional({
    example: 'story with no relevant performance NFR',
    description:
      'Why the lead chose NOT to delegate — required when `status` is ' +
      '"dispensed". Never left blank: dispensing is a recorded decision, not ' +
      'silence (CLAUDE.md, Phase 8b item 2).',
  })
  @IsOptional()
  @IsString()
  justification?: string;
}
