import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiProperty({
    example: 'heartbeat_timeout',
    description:
      'The ORIGIN of the failure. Never deduced by elimination — lesson from ADR 0020.',
  })
  @IsString()
  causa!: string;

  @ApiProperty({ example: 'closed_abnormally' })
  @IsString()
  estadoDaSessao!: string;

  @ApiProperty({
    example: 'The agent stopped responding after a 90s tool call.',
  })
  @IsString()
  analise!: string;
}

export class HypothesisDraftDto {
  @ApiProperty({ example: 'dev-api' })
  @IsString()
  agenteAlvo!: string;

  @ApiProperty({ example: 'The agent reopened the same task three times.' })
  @IsString()
  observacao!: string;

  @ApiProperty({
    example: "The instructions don't say when the task is done.",
  })
  @IsString()
  hipotese!: string;

  @ApiProperty({ example: 'Add an explicit definition-of-done criterion.' })
  @IsString()
  sugestao!: string;

  // Faixa também validada no domínio (hypothesis-evidence.ts) — aqui é só
  // a barreira de entrada do DTO; a regra de negócio mora no domínio.
  @ApiProperty({
    example: 72,
    minimum: 0,
    maximum: 100,
    description: 'Self-reported by the model, not measured.',
  })
  @IsInt()
  @Min(0)
  @Max(100)
  confiancaPercent!: number;

  @ApiProperty({
    example: ['01JC4Z8QK3M7YV2N5T9B0PXHRB'],
    description:
      'At least one, and each one has to EXIST in this session. Made-up ' +
      'evidence is rejected with 400 — that is what separates a hypothesis from an opinion.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  evidenceEventIds!: string[];

  @ApiPropertyOptional({
    type: HypothesisTerminationAnalysisDto,
    description: 'REQUIRED when `cause` indicates an abnormal termination.',
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => HypothesisTerminationAnalysisDto)
  terminationAnalysis?: HypothesisTerminationAnalysisDto | null;
}

export class ProposeHypothesesInternalDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({
    enum: ['leve', 'pesada'],
    example: 'leve',
    description:
      'The two tiers use genuinely different models; the cost diverges.',
  })
  @IsIn(['leve', 'pesada'])
  tier!: 'leve' | 'pesada';

  @ApiProperty({ enum: ['auto', 'manual'], example: 'auto' })
  @IsIn(['auto', 'manual'])
  triggeredBy!: 'auto' | 'manual';

  @ApiProperty({ example: 128, description: 'Size of the analyzed log.' })
  @IsInt()
  @Min(0)
  eventCount!: number;

  // Causa CLASSIFICADA pelo engine (Engine.Psychologist.TerminationClassifier)
  // a partir de sessions.termination_reason — é ela, e não o status terminal,
  // que decide se `terminationAnalysis` é obrigatória. Opcional pra não
  // quebrar um engine mais antigo em rolling deploy: sem ela, o domínio cai
  // no comportamento anterior (status === 'closed_abnormally').
  @IsOptional()
  // Mantenha em sincronia com TerminationCause em
  // domain/psychologist/hypothesis-evidence.ts. Divergir é caro e silencioso:
  // um valor válido no engine e ausente aqui vira 400, o 400 volta ao modelo
  // como resultado de tool, e o ToolLoop gira até estourar max_iterations —
  // gastando orçamento sem nunca conseguir registrar a hipótese.
  @ApiPropertyOptional({
    enum: ['normal', 'timeout', 'kill', 'crash', 'node_shutdown', 'unknown'],
    example: 'timeout',
    description:
      'Cause CLASSIFIED by the engine. It, not the terminal status, decides ' +
      'whether `terminationAnalysis` is required. Optional so as not to break ' +
      'an older engine during a rolling deploy.',
  })
  @IsIn(['normal', 'timeout', 'kill', 'crash', 'node_shutdown', 'unknown'])
  cause?: 'normal' | 'timeout' | 'kill' | 'crash' | 'node_shutdown' | 'unknown';

  @ApiProperty({ type: [HypothesisDraftDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => HypothesisDraftDto)
  hypotheses!: HypothesisDraftDto[];
}
