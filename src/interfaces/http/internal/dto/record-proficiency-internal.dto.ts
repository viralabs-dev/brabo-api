import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class ProficiencyDraftDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000USUARIO0000000002' })
  @IsUUID()
  userId!: string;

  // Faixa de valores validada NO DOMÍNIO (competency-catalog): o DTO só
  // garante o tipo — o catálogo permitido depende do module_map.
  @ApiProperty({
    example: 'TypeScript',
    description:
      'Has to be in the catalog returned by `anamnese-context` — a made-up ' +
      'competency is REJECTED. The catalog depends on the `module_map`, which ' +
      'is why the validation is a domain one, not a DTO one.',
  })
  @IsString()
  competency!: string;

  @ApiProperty({
    enum: ['iniciante', 'intermediario', 'avancado'],
    example: 'avancado',
  })
  @IsString()
  level!: string;

  @ApiProperty({
    example: 'Fixed three generic typing errors without help.',
  })
  @IsString()
  rationale!: string;

  @ApiProperty({
    example: ['01JC4Z8QK3M7YV2N5T9B0PXHRB'],
    description:
      'Each id has to be from a session event OF THIS project — citing an ' +
      'event from another project is refused.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  evidenceEventIds!: string[];
}

export class RecordProficiencyInternalDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({ example: '2026-07-27T12:00:00.000Z', format: 'date-time' })
  @IsDateString()
  windowFrom!: string;

  @ApiProperty({ example: '2026-07-27T12:15:00.000Z', format: 'date-time' })
  @IsDateString()
  windowTo!: string;

  @ApiProperty({ example: 240 })
  @IsInt()
  @Min(0)
  eventCount!: number;

  @ApiProperty({ type: [ProficiencyDraftDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ProficiencyDraftDto)
  profiles!: ProficiencyDraftDto[];
}

export class ProposeInstructionPatchInternalDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({ example: 'dev-api' })
  @IsString()
  agent!: string;

  @ApiProperty({
    example: '# dev-api\n\nAlways run the suite before opening the PR.',
    description: 'The WHOLE file as it would end up, not a diff.',
  })
  @IsString()
  proposedContent!: string;

  @ApiProperty({
    example: 'The task was reopened three times for lack of a criterion.',
  })
  @IsString()
  rationale!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '01JC4Z0000HIPOTESE000000001',
    description:
      'The hypothesis that motivated the patch. This is what closes the Anamnesis loop.',
  })
  @IsOptional()
  @IsUUID()
  hypothesisId?: string;
}

/**
 * A Anamnese propondo subir o teto de paralelismo de uma área (FASE 14d).
 *
 * Vira `proposed_action` que NUNCA se auto-aprova (teto em `decide.ts`):
 * automatizar o ajuste seria o produto elevando o próprio limite de gasto.
 */
export class ProposeMaxParallelInternalDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({
    example: 'dev',
    description: 'The area whose cap would go up.',
  })
  @IsString()
  area!: string;

  @ApiProperty({
    example: 4,
    minimum: 1,
    description:
      'The proposed cap. Has to be HIGHER than the current one — proposing ' +
      'the same or less turns into noise in a queue the user needs to read, ' +
      'and the Anamnesis runs periodically.',
  })
  @IsInt()
  @Min(1)
  proposto!: number;

  @ApiProperty({
    example:
      'You authorized the same request four times in this window, and none was denied.',
    description: 'Anchored in OBSERVED DECISIONS, not an impression.',
  })
  @IsString()
  rationale!: string;
}
