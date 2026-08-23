import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { TIPOS_DE_ATOR_C4 } from '../../../../domain/architecture/c4-diagram';

/**
 * Chamada interna do engine (ferramenta `create_c4_diagram` do Arquiteto).
 *
 * A validação de verdade — `system_name` obrigatório, `type` de ator dentro
 * do enum — é de DOMÍNIO (`validarEntradaC4`), como em
 * `DecideProjectImageInternalDto`: o DTO garante a forma do transporte, a
 * regra garante o que é uma entrada válida. Os módulos NÃO entram aqui — o
 * Container level é derivado do `module_map` vigente pelo caso de uso, nunca
 * redigitado pelo modelo.
 */
export class C4AtorInternalDto {
  @ApiProperty({ example: 'User' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({
    enum: TIPOS_DE_ATOR_C4 as unknown as string[],
    default: 'person',
    example: 'person',
    description:
      '`person` (default) for whoever operates the system; `external_system` ' +
      'for another system it talks to (e.g. a Git provider).',
  })
  @IsOptional()
  @IsIn(TIPOS_DE_ATOR_C4)
  type?: 'person' | 'external_system';

  @ApiPropertyOptional({ example: 'Whoever operates the product via the web.' })
  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateC4DiagramInternalDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({
    example: 'Brabo',
    description: "System/project name, for the diagram's label.",
  })
  @IsString()
  @MinLength(1)
  systemName!: string;

  @ApiPropertyOptional({
    example: 'Agent-orchestrated engineering platform.',
  })
  @IsOptional()
  @IsString()
  systemDescription?: string;

  @ApiPropertyOptional({
    type: [C4AtorInternalDto],
    description:
      "External actors of the Context level (Simon Brown). The Container " +
      "level's containers do NOT go here: they come from the project's " +
      'current module_map.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => C4AtorInternalDto)
  actors?: C4AtorInternalDto[];
}
