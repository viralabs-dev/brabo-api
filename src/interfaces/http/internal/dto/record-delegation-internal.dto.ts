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
      'A área que delegou — "qa" (Fase 8b) ou "infra" (Fase 8c). Texto, não enum.',
  })
  @IsString()
  area!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '01JC4Z0000TASK00000000001',
    description:
      'A task de backlog por trás da delegação, quando existir. QA (Fase 8b) sempre manda; ' +
      'Infra (Fase 8c) nunca manda — a delegação é sobre a SESSÃO, não sobre uma task.',
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
      'Id do session_event `artifact.qa_verdict` do PARECER DESTA subespecialidade ' +
      '— obrigatório quando `status` é "completed".',
  })
  @IsOptional()
  @IsString()
  parecerArtifactId?: string;

  @ApiPropertyOptional({
    enum: FAILURE_ORIGINS,
    example: 'infra',
    description:
      'A ORIGEM da falha (ADR 0020/0038), nunca por eliminação — obrigatório ' +
      'quando `status` é "failed".',
  })
  @IsOptional()
  @IsIn(FAILURE_ORIGINS)
  failureOrigin?: (typeof FAILURE_ORIGINS)[number];

  @ApiPropertyOptional({
    example: 'limite de iterações atingido sem emit_perf_seguranca_verdict',
  })
  @IsOptional()
  @IsString()
  failureReason?: string;

  @ApiPropertyOptional({
    example: 'story sem RNF de performance pertinente',
    description:
      'Por que o lead optou por NÃO delegar — obrigatório quando `status` é ' +
      '"dispensed". Nunca fica em branco: dispensa é decisão registrada, não ' +
      'silêncio (CLAUDE.md, Fase 8b item 2).',
  })
  @IsOptional()
  @IsString()
  justification?: string;
}
