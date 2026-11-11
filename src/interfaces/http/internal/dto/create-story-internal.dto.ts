import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsNotEmpty,
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

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'RN-859 (ADR 0214): an open question the user ALREADY answered — only ' +
      'then a `ready` story (no task in execution) can be corrected.',
  })
  @IsOptional()
  @IsUUID()
  questionId?: string;
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

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'RN-859 (ADR 0214): an open question the user ALREADY answered — only ' +
      'then a `ready` story (no task in execution) can be corrected.',
  })
  @IsOptional()
  @IsUUID()
  questionId?: string;
}

// Ferramenta update_task do PO e do Dev Lead (RN-1068): corrige título e/ou
// descrição de uma tarefa `todo`. Campo omitido fica.
export class UpdateTaskInternalDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiPropertyOptional({ enum: ['po', 'dev-lead'], default: 'po' })
  @IsOptional()
  @IsIn(['po', 'dev-lead'])
  agentId?: 'po' | 'dev-lead';

  @ApiPropertyOptional({ example: 'Return 200 for a past date' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ example: 'The day agenda accepts a past date.' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'RN-859: an open question the user ALREADY answered — only then a task ' +
      'of a `ready` story can be corrected.',
  })
  @IsOptional()
  @IsUUID()
  questionId?: string;
}

// Ferramenta arquivar_tarefa do Dev Lead (AT-912): só tarefa `todo` que ELE
// criou, e com motivo obrigatório (a mesma régua da tela, mais a autoria).
export class ArchiveTaskInternalDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({ example: 'Duplicate foundation task.' })
  @IsString()
  @IsNotEmpty()
  reason!: string;
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
