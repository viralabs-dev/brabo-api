import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

// Chamada interna do engine (ferramenta create_task do PO e do Dev Lead).
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

  @ApiPropertyOptional({
    enum: ['po', 'dev_lead'],
    default: 'po',
    description: 'Agent creating the task; becomes the actor of the event.',
  })
  @IsOptional()
  @IsIn(['po', 'dev_lead'])
  agentRole?: 'po' | 'dev_lead';
}
