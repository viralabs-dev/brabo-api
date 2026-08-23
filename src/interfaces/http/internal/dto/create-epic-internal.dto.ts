import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

// Chamada interna do engine (ferramenta create_epic do PO).
export class CreateEpicInternalDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({ example: 'Shopping cart' })
  @IsString()
  title!: string;

  @ApiPropertyOptional({ example: 'Everything the buyer does before paying.' })
  @IsOptional()
  @IsString()
  description?: string;
}
