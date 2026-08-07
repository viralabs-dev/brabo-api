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
      'Precisa estar no catálogo devolvido em `anamnese-context` — competência ' +
      'inventada é RECUSADA. O catálogo depende do `module_map`, por isso a ' +
      'validação é de domínio e não do DTO.',
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
    example: 'Corrigiu três erros de tipagem genérica sem ajuda.',
  })
  @IsString()
  rationale!: string;

  @ApiProperty({
    example: ['01JC4Z8QK3M7YV2N5T9B0PXHRB'],
    description:
      'Cada id tem de ser de um evento de sessão DESTE projeto — citar evento de ' +
      'outro projeto é recusado.',
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
    example: '# dev-api\n\nSempre rode a suíte antes de abrir a PR.',
    description: 'O arquivo INTEIRO como ficaria, não um diff.',
  })
  @IsString()
  proposedContent!: string;

  @ApiProperty({
    example: 'A tarefa foi reaberta três vezes por falta de critério.',
  })
  @IsString()
  rationale!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '01JC4Z0000HIPOTESE000000001',
    description:
      'A hipótese que motivou o patch. É o que fecha o loop da Anamnese.',
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
    description: 'A área cujo teto subiria.',
  })
  @IsString()
  area!: string;

  @ApiProperty({
    example: 4,
    minimum: 1,
    description:
      'O teto proposto. Precisa ser MAIOR que o vigente — propor o mesmo ou ' +
      'menos vira ruído numa fila que o usuário precisa ler, e a Anamnese roda ' +
      'periodicamente.',
  })
  @IsInt()
  @Min(1)
  proposto!: number;

  @ApiProperty({
    example:
      'Você autorizou o mesmo pedido quatro vezes nesta janela, e nenhuma foi negada.',
    description: 'Ancorado nas DECISÕES observadas, não em impressão.',
  })
  @IsString()
  rationale!: string;
}
