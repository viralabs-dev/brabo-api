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

  @ApiProperty({ example: 'Adicionar item ao carrinho' })
  @IsString()
  title!: string;

  @ApiPropertyOptional({
    example: 'Como comprador, quero juntar itens antes de pagar.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: ['O carrinho aceita até 50 itens'] })
  @IsOptional()
  @IsArray()
  rf?: string[];

  @ApiPropertyOptional({ example: ['Resposta abaixo de 200 ms no p95'] })
  @IsOptional()
  @IsArray()
  rnf?: string[];

  @ApiPropertyOptional({ example: ['Testes de unidade verdes'] })
  @IsOptional()
  @IsArray()
  dod?: string[];

  @ApiPropertyOptional({ example: ['Módulo definido'] })
  @IsOptional()
  @IsArray()
  dor?: string[];

  @ApiPropertyOptional({
    example: ['RN-014'],
    description:
      'Cada id precisa referenciar um evento `artifact.business_rule` que EXISTE — id inventado é recusado.',
  })
  @IsOptional()
  @IsArray()
  businessRuleIds?: string[];
}
