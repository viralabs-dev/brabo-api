import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

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

// Ferramenta complete_story do PO (RN-720): completa uma história draft
// existente em vez de recriá-la. Listas omitidas ficam como estão.
export class CompleteStoryInternalDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiPropertyOptional({ example: 'As a buyer, I want to pay by card.' })
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
      'ADDED to the rules the story already cites (completing never unlinks a rule); each new id has to reference an existing `artifact.business_rule`.',
  })
  @IsOptional()
  @IsArray()
  businessRuleIds?: string[];
}

// Ferramenta update_story do PO (RN-727): corrige título e/ou descrição de
// uma história draft sem tarefa em execução. Campo omitido fica.
export class UpdateStoryInternalDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiPropertyOptional({ example: 'Register a user' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ example: 'As a visitor, I want to sign up.' })
  @IsOptional()
  @IsString()
  description?: string;
}

// Ferramenta archive_story do PO (RN-727): arquiva uma história draft sem
// tarefa em execução — ela e as tarefas saem do jogo, nada é apagado.
export class ArchiveStoryInternalDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiPropertyOptional({ example: 'Duplicate of "Register a user".' })
  @IsOptional()
  @IsString()
  reason?: string;
}
