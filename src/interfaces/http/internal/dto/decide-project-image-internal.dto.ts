import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { POSTURAS_DE_REDE } from '../../../../domain/containers/project-container';

/**
 * Chamada interna do engine (ferramenta `choose_project_image` do Arquiteto).
 *
 * A validação de verdade — tag explícita, `latest` recusado, teto de recursos
 * — é de DOMÍNIO (`validarDecisaoDeImagem`), e não some daqui por preguiça: o
 * DTO garante a forma do transporte, e a regra garante o que é uma decisão
 * válida. Duplicar a regra no DTO faria duas versões dela divergirem.
 */
export class DecideProjectImageInternalDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({
    example: 'node:22-bookworm-slim',
    description:
      'OCI reference with an explicit TAG or digest. `latest` is REFUSED with ' +
      '400 — the rule is domain-level.',
  })
  @IsString()
  image!: string;

  @ApiProperty({
    example:
      'The module_map is TypeScript on Node 22; the slim variant has the runtime and nothing else.',
    description: 'Why this image. Minimum of 10 characters.',
  })
  @IsString()
  @MinLength(10)
  rationale!: string;

  @ApiPropertyOptional({
    enum: POSTURAS_DE_REDE as unknown as string[],
    default: 'none',
    description:
      "The container's network posture. `none` is the default, and it is " +
      'what makes "inside, the agent is free" a safe sentence.',
  })
  @IsOptional()
  @IsIn(POSTURAS_DE_REDE)
  network?: 'none' | 'egress';

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { cpus: 2, memoryMb: 4096, pidsLimit: 512 },
    description:
      'Resource cap. Above the maximum, the decision is REFUSED, never ' +
      'silently downgraded.',
  })
  @IsOptional()
  @IsObject()
  resources?: Record<string, unknown>;
}
