import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

// Chamada interna do engine (ferramenta create_task do PO).
export class CreateTaskInternalDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({ format: 'uuid', example: '01JC4Z0000HISTORIA000000001' })
  @IsUUID()
  storyId!: string;

  @ApiProperty({ example: 'Endpoint POST /cart/items' })
  @IsString()
  title!: string;

  @ApiPropertyOptional({
    example: 'Accepts SKU and quantity; validates stock.',
  })
  @IsOptional()
  @IsString()
  description?: string;
}
