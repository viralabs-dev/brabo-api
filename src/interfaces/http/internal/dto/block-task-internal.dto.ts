import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID } from 'class-validator';

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
    example: 'infra',
    description:
      'A ORIGEM da falha: `infra`, `modelo`, `código` ou `política`. Nunca por eliminação — é a lição do ADR 0020.',
  })
  @IsString()
  diagnosis!: string;
}
