import { IsArray, IsOptional, IsString, IsUUID } from 'class-validator';

// Chamada interna do engine (ferramenta create_story do PO). Validação leve
// de propósito (cliente confiável); a validação de negócio (regra existe,
// prontidão) fica no CreateStoryUseCase/domínio.
export class CreateStoryInternalDto {
  @IsUUID()
  projectId!: string;

  @IsUUID()
  epicId!: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  rf?: string[];

  @IsOptional()
  @IsArray()
  rnf?: string[];

  @IsOptional()
  @IsArray()
  dod?: string[];

  @IsOptional()
  @IsArray()
  dor?: string[];

  @IsOptional()
  @IsArray()
  businessRuleIds?: string[];
}
