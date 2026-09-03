import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

/**
 * Chamada interna do engine (ferramenta `route_modules_to_infra` do
 * Arquiteto).
 *
 * A validação de verdade — módulo existente no `module_map` vigente, imagem
 * com tag/digest explícito, `latest` recusado, `rationale` real — é de
 * DOMÍNIO (`validarRoteamento`, que delega a `validarDecisaoDeImagem`), mesmo
 * padrão de `DecideProjectImageInternalDto`: o DTO garante a forma do
 * transporte, a regra garante o que é um roteamento válido.
 */
export class RoteamentoDeModuloInternalDto {
  @ApiProperty({
    example: 'checkout-api',
    description: 'Nome do módulo — precisa existir no module_map vigente.',
  })
  @IsString()
  modulo!: string;

  @ApiProperty({
    example: 'node:22-bookworm-slim',
    description:
      'OCI reference with an explicit TAG or digest for this module. ' +
      '`latest` is REFUSED with 400 — the rule is domain-level.',
  })
  @IsString()
  imagemCandidata!: string;

  @ApiProperty({
    example:
      'This module is TypeScript on Node 22; the slim variant has the runtime and nothing else.',
    description: 'Why THIS image for THIS module. Minimum of 10 characters.',
  })
  @IsString()
  porque!: string;
}

export class RouteModulesToInfraInternalDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({
    type: [RoteamentoDeModuloInternalDto],
    description:
      'One item per module of the current module_map. The candidate image ' +
      'is the Architect proposing, not deciding — Infra elects among the ' +
      'candidates in a later step.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RoteamentoDeModuloInternalDto)
  roteamento!: RoteamentoDeModuloInternalDto[];
}
