import { ApiProperty } from '@nestjs/swagger';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';
import {
  TIPOS_DE_ITEM_DE_CONTRATO,
  type ContratoDeModulo,
  type ItemDeContrato,
  type TipoDeItemDeContrato,
} from '../../../../domain/architecture/module-contracts';
import type { ContratosDeclarados } from '../../../../application/use-cases/architecture/declare-module-contracts.use-case';
import type {
  ContratoLidoDeModulo,
  ContratosDoProjeto,
} from '../../../../application/use-cases/architecture/list-module-contracts.use-case';

/** Respostas do contrato entre módulos (ADR 0200, RN-684). */
export class ItemDeContratoResponseDto implements Wire<ItemDeContrato> {
  @ApiProperty({
    enum: TIPOS_DE_ITEM_DE_CONTRATO as unknown as string[],
    example: 'funcao',
  })
  tipo!: TipoDeItemDeContrato;

  @ApiProperty({
    example: 'placePiece(board: Board, piece: Piece, pos: Pos): Board',
  })
  assinatura!: string;

  @ApiProperty({
    example: 'Returns a new board; never mutates the one passed in.',
  })
  descricao!: string;
}
export const _chavesItemDeContrato: MesmasChaves<
  ItemDeContratoResponseDto,
  ItemDeContrato
> = true;

export class ContratoDeModuloResponseDto implements Wire<ContratoDeModulo> {
  @ApiProperty({ example: 'board-engine' })
  modulo!: string;

  @ApiProperty({ type: [ItemDeContratoResponseDto] })
  expoe!: ItemDeContratoResponseDto[];
}
export const _chavesContratoDeModulo: MesmasChaves<
  ContratoDeModuloResponseDto,
  ContratoDeModulo
> = true;

/** Response for `POST .../module-contracts`: the declared list + the version. */
export class ContratosDeclaradosResponseDto implements Wire<ContratosDeclarados> {
  @ApiProperty({ type: [ContratoDeModuloResponseDto] })
  contratos!: ContratoDeModuloResponseDto[];

  @ApiProperty({ example: 1 })
  version!: number;
}
export const _chavesContratosDeclarados: MesmasChaves<
  ContratosDeclaradosResponseDto,
  ContratosDeclarados
> = true;

export class ContratoLidoDeModuloResponseDto implements Wire<ContratoLidoDeModulo> {
  @ApiProperty({ example: 'game-session' })
  modulo!: string;

  @ApiProperty({
    type: [String],
    example: ['board-engine', 'scoring'],
    description:
      "The current module_map's `dependsOn`: what this module CONSUMES.",
  })
  dependeDe!: string[];

  @ApiProperty({
    type: [ItemDeContratoResponseDto],
    nullable: true,
    description:
      'What it exposes. `null` = the Architect declared no contract for ' +
      'this module (different from exposing nothing).',
  })
  expoe!: ItemDeContratoResponseDto[] | null;
}
export const _chavesContratoLidoDeModulo: MesmasChaves<
  ContratoLidoDeModuloResponseDto,
  ContratoLidoDeModulo
> = true;

/** Response for `GET internal/projects/:projectId/module-contracts`. */
export class ContratosDoProjetoResponseDto implements Wire<ContratosDoProjeto> {
  @ApiProperty({ enum: ['sem_contratos', 'declarados'] })
  status!: 'sem_contratos' | 'declarados';

  @ApiProperty({ example: 2, description: '0 when there is no contract.' })
  version!: number;

  @ApiProperty({
    type: [ContratoLidoDeModuloResponseDto],
    description: 'One per module of the CURRENT module_map, in map order.',
  })
  modulos!: ContratoLidoDeModuloResponseDto[];

  @ApiProperty({
    type: [String],
    example: [],
    description:
      'Contracts of modules the current module_map no longer has — said, ' +
      'never attached to a module that does not exist.',
  })
  contratosForaDoMapa!: string[];
}
export const _chavesContratosDoProjeto: MesmasChaves<
  ContratosDoProjetoResponseDto,
  ContratosDoProjeto
> = true;
