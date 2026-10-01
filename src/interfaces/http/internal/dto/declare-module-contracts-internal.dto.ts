import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { TIPOS_DE_ITEM_DE_CONTRATO } from '../../../../domain/architecture/module-contracts';

/**
 * Chamada interna do engine (ferramenta `declare_module_contracts` do
 * Arquiteto, ADR 0200, RN-684).
 *
 * A validação de verdade — `tipo` no enum, `assinatura` obrigatória e com
 * teto, módulo existente no `module_map` vigente, módulo repetido, `expoe`
 * vazio ou longo demais — é de DOMÍNIO (`validarContratos`), mesmo padrão de
 * `RouteModulesToInfraInternalDto`: o DTO garante a forma do transporte, a
 * regra garante o que é um contrato válido — e a mensagem dela, que nomeia o
 * módulo e o item, é a que volta ao modelo.
 */
export class ItemDeContratoInternalDto {
  @ApiProperty({
    enum: TIPOS_DE_ITEM_DE_CONTRATO as unknown as string[],
    example: 'funcao',
    description:
      'How another module uses the item: call a function, hit a route, ' +
      'subscribe to an event, or build a data shape.',
  })
  @IsString()
  tipo!: string;

  @ApiProperty({
    example: 'placePiece(board: Board, piece: Piece, pos: Pos): Board',
    description: 'How another module uses it. Up to 300 characters.',
  })
  @IsString()
  assinatura!: string;

  @ApiPropertyOptional({
    example: 'Returns a new board; never mutates the one passed in.',
  })
  @IsOptional()
  @IsString()
  descricao?: string;
}

export class ContratoDeModuloInternalDto {
  @ApiProperty({
    example: 'board-engine',
    description: 'Module name — must exist in the current module_map.',
  })
  @IsString()
  modulo!: string;

  @ApiProperty({
    type: [ItemDeContratoInternalDto],
    description: 'What the module exposes to whoever depends on it. 1 to 40.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemDeContratoInternalDto)
  expoe!: ItemDeContratoInternalDto[];
}

export class DeclareModuleContractsInternalDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({
    type: [ContratoDeModuloInternalDto],
    description:
      'The WHOLE contract list: each call is a new version that replaces the ' +
      'previous one. What a module CONSUMES is not here — it is derived from ' +
      "the current module_map's `dependsOn` when read.",
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ContratoDeModuloInternalDto)
  contratos!: ContratoDeModuloInternalDto[];
}
