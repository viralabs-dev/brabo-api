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
  @IsUUID()
  userId!: string;

  // Faixa de valores validada NO DOMÍNIO (competency-catalog): o DTO só
  // garante o tipo — o catálogo permitido depende do module_map.
  @IsString()
  competency!: string;

  @IsString()
  level!: string;

  @IsString()
  rationale!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  evidenceEventIds!: string[];
}

export class RecordProficiencyInternalDto {
  @IsUUID()
  projectId!: string;

  @IsDateString()
  windowFrom!: string;

  @IsDateString()
  windowTo!: string;

  @IsInt()
  @Min(0)
  eventCount!: number;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ProficiencyDraftDto)
  profiles!: ProficiencyDraftDto[];
}

export class ProposeInstructionPatchInternalDto {
  @IsUUID()
  projectId!: string;

  @IsString()
  agent!: string;

  @IsString()
  proposedContent!: string;

  @IsString()
  rationale!: string;

  @IsOptional()
  @IsUUID()
  hypothesisId?: string;
}
