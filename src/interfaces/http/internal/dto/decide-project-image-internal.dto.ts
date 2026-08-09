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
      'Referência OCI com TAG explícita ou digest. `latest` é RECUSADO com ' +
      '400 — a regra é de domínio.',
  })
  @IsString()
  image!: string;

  @ApiProperty({
    example:
      'O module_map é TypeScript sobre Node 22; a slim tem o runtime e nada mais.',
    description: 'Por que esta imagem. Mínimo de 10 caracteres.',
  })
  @IsString()
  @MinLength(10)
  rationale!: string;

  @ApiPropertyOptional({
    enum: POSTURAS_DE_REDE as unknown as string[],
    default: 'none',
    description:
      'Postura de rede do container. `none` é o default, e é o que torna ' +
      '"dentro o agente é livre" uma frase segura.',
  })
  @IsOptional()
  @IsIn(POSTURAS_DE_REDE)
  network?: 'none' | 'egress';

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { cpus: 2, memoryMb: 4096, pidsLimit: 512 },
    description:
      'Teto de recursos. Acima do máximo a decisão é RECUSADA, nunca ' +
      'rebaixada em silêncio.',
  })
  @IsOptional()
  @IsObject()
  resources?: Record<string, unknown>;
}
