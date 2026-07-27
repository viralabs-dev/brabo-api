import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

// Chamada interna do engine: o Criativo oferece o handoff ao PO ao emitir o
// product_brief. `artifactId` é o session_events.id (ULID) do artefato.
export class CreateHandoffInternalDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({ example: 'criativo' })
  @IsString()
  fromAgent!: string;

  @ApiProperty({ example: 'po' })
  @IsString()
  toAgent!: string;

  @ApiPropertyOptional({
    example: '01JC4Z8QK3M7YV2N5T9B0PXHRB',
    description: 'ULID do session_event do artefato que motivou o handoff.',
  })
  @IsOptional()
  @IsString()
  artifactId?: string;
}
