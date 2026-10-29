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
