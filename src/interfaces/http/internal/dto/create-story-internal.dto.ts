import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, IsUUID } from 'class-validator';

// Chamada interna do engine (ferramenta create_story do PO). Validação leve
// de propósito (cliente confiável); a validação de negócio (regra existe,
// prontidão) fica no CreateStoryUseCase/domínio.
export class CreateStoryInternalDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({ format: 'uuid', example: '01JC4Z0000EPICO000000000001' })
  @IsUUID()
  epicId!: string;

  @ApiProperty({ example: 'Add item to cart' })
  @IsString()
  title!: string;

  @ApiPropertyOptional({
    example: 'As a buyer, I want to gather items before paying.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: ['The cart accepts up to 50 items'] })
  @IsOptional()
  @IsArray()
  rf?: string[];

  @ApiPropertyOptional({ example: ['Response under 200ms at p95'] })
  @IsOptional()
  @IsArray()
  rnf?: string[];

  @ApiPropertyOptional({ example: ['Unit tests green'] })
  @IsOptional()
  @IsArray()
  dod?: string[];

  @ApiPropertyOptional({ example: ['Module defined'] })
  @IsOptional()
  @IsArray()
  dor?: string[];

  @ApiPropertyOptional({
    example: ['RN-014'],
    description:
      'Each id needs to reference an `artifact.business_rule` event that EXISTS — a made-up id is refused.',
  })
  @IsOptional()
  @IsArray()
  businessRuleIds?: string[];
}
