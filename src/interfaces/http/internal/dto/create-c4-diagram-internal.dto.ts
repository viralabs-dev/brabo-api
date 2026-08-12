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
  @ApiProperty({ example: 'Usuário' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({
    enum: TIPOS_DE_ATOR_C4 as unknown as string[],
    default: 'person',
    example: 'person',
    description:
      '`person` (default) para quem opera o sistema; `external_system` para ' +
      'outro sistema com o qual ele conversa (ex.: um provedor de Git).',
  })
  @IsOptional()
  @IsIn(TIPOS_DE_ATOR_C4)
  type?: 'person' | 'external_system';

  @ApiPropertyOptional({ example: 'Quem opera o produto pela web.' })
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
    description: 'Nome do sistema/projeto, para o rótulo do diagrama.',
  })
  @IsString()
  @MinLength(1)
  systemName!: string;

  @ApiPropertyOptional({
    example: 'Plataforma de engenharia orquestrada por agentes.',
  })
  @IsOptional()
  @IsString()
  systemDescription?: string;

  @ApiPropertyOptional({
    type: [C4AtorInternalDto],
    description:
      'Atores externos do nível Context (Simon Brown). Os containers do ' +
      'nível Container NÃO entram aqui: vêm do module_map vigente do ' +
      'projeto.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => C4AtorInternalDto)
  actors?: C4AtorInternalDto[];
}
