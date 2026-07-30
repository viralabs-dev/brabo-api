import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { FAILURE_ORIGINS, type FailureOrigin } from '../../../../domain/agents/failure-origin';

export class BlockTaskInternalDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({ example: 'dev-api' })
  @IsString()
  agentId!: string;

  @ApiProperty({ example: 'Teto de correções de gate atingido.' })
  @IsString()
  reason!: string;

  @ApiProperty({
    example: 'Ciclo de correção esgotado sem exit 0.',
    description: 'Diagnóstico em texto livre — detalhe humano do que aconteceu, não a origem estruturada da falha.',
  })
  @IsString()
  diagnosis!: string;

  @ApiPropertyOptional({
    enum: FAILURE_ORIGINS,
    example: 'infra',
    description:
      'A ORIGEM da falha: `infra`, `modelo`, `codigo` ou `politica`. Nunca por eliminação — é a lição do ' +
      'ADR 0020, retomada um nível acima pelo QA Lead no ADR 0038. Opcional: nem todo call site conhece a origem.',
  })
  @IsOptional()
  @IsIn(FAILURE_ORIGINS)
  origin?: FailureOrigin;
}
