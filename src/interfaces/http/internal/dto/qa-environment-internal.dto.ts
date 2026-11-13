import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsUUID } from 'class-validator';

export class QaEnvironmentResponseDto {
  @ApiProperty({
    description: '`false` when the broker refused; `motivo` explains.',
  })
  sucesso!: boolean;

  @ApiProperty({ enum: ['provisioning', 'running', 'failed', 'removed'] })
  status!: string;

  @ApiProperty({
    example: 'a1b2c3d4',
    description: 'Instance key (8 chars of the task id).',
  })
  chave!: string;

  @ApiProperty({ type: String, nullable: true })
  motivo!: string | null;
}

export class SweepQaEnvironmentsInternalDto {
  @ApiProperty({
    type: [String],
    description:
      'Task ids that still have a gate in flight; every other active instance is removed.',
  })
  @IsArray()
  @IsUUID('all', { each: true })
  taskIdsEmVoo!: string[];

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Limit the sweep to one project.',
  })
  @IsOptional()
  @IsUUID()
  projectId?: string;
}

export class SweepQaEnvironmentsResponseDto {
  @ApiProperty({ type: [String] })
  removidas!: string[];

  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: { taskId: { type: 'string' }, motivo: { type: 'string' } },
    },
  })
  falhas!: Array<{ taskId: string; motivo: string }>;
}

export class ComposeProofSondaDto {
  @ApiProperty({ example: '/docs' })
  caminho!: string;

  @ApiProperty({ description: 'HTTP status; 0 when the probe got no answer.' })
  status!: number;
}

export class ComposeProofRecusaDto {
  @ApiProperty({ example: 'privileged' })
  campo!: string;

  @ApiProperty()
  motivo!: string;
}

export class ComposeProofResultadoDto {
  @ApiProperty()
  subiu!: boolean;

  @ApiProperty({ type: [ComposeProofSondaDto] })
  sondas!: ComposeProofSondaDto[];

  @ApiPropertyOptional({ type: [ComposeProofRecusaDto] })
  recusas?: ComposeProofRecusaDto[];

  @ApiProperty({ enum: ['projeto', 'infra'] })
  origem!: 'projeto' | 'infra';
}

export class QaComposeProofResponseDto {
  @ApiProperty({
    enum: ['provou', 'falhou', 'aprova_com_aviso'],
    description:
      "`falhou` is the PROJECT's fault (a verdict item); `aprova_com_aviso` means the proof could not run (no broker, runner, infra origin, ceiling).",
  })
  veredito!: 'provou' | 'falhou' | 'aprova_com_aviso';

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'sem prova de compose',
    description: 'The warning the verdict must carry; `null` otherwise.',
  })
  aviso!: string | null;

  @ApiProperty({ type: String, nullable: true })
  motivo!: string | null;

  @ApiProperty({ example: 'a1b2c3d4' })
  chave!: string;

  @ApiProperty({ type: ComposeProofResultadoDto, nullable: true })
  resultado!: ComposeProofResultadoDto | null;
}
