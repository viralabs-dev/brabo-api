import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class HypothesisTerminationAnalysisDto {
  @IsString()
  causa!: string;

  @IsString()
  estadoDaSessao!: string;

  @IsString()
  analise!: string;
}

export class HypothesisDraftDto {
  @IsString()
  agenteAlvo!: string;

  @IsString()
  observacao!: string;

  @IsString()
  hipotese!: string;

  @IsString()
  sugestao!: string;

  // Faixa também validada no domínio (hypothesis-evidence.ts) — aqui é só
  // a barreira de entrada do DTO; a regra de negócio mora no domínio.
  @IsInt()
  @Min(0)
  @Max(100)
  confiancaPercent!: number;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  evidenceEventIds!: string[];

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => HypothesisTerminationAnalysisDto)
  terminationAnalysis?: HypothesisTerminationAnalysisDto | null;
}

export class ProposeHypothesesInternalDto {
  @IsUUID()
  projectId!: string;

  @IsIn(['leve', 'pesada'])
  tier!: 'leve' | 'pesada';

  @IsIn(['auto', 'manual'])
  triggeredBy!: 'auto' | 'manual';

  @IsInt()
  @Min(0)
  eventCount!: number;

  // Causa CLASSIFICADA pelo engine (Engine.Psychologist.TerminationClassifier)
  // a partir de sessions.termination_reason — é ela, e não o status terminal,
  // que decide se `terminationAnalysis` é obrigatória. Opcional pra não
  // quebrar um engine mais antigo em rolling deploy: sem ela, o domínio cai
  // no comportamento anterior (status === 'closed_abnormally').
  @IsOptional()
  @IsIn(['normal', 'timeout', 'kill', 'crash', 'unknown'])
  cause?: 'normal' | 'timeout' | 'kill' | 'crash' | 'unknown';

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => HypothesisDraftDto)
  hypotheses!: HypothesisDraftDto[];
}
