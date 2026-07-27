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
      'A ORIGEM da falha. Nunca deduzida por eliminação — lição do ADR 0020.',
  })
  @IsString()
  causa!: string;

  @ApiProperty({ example: 'closed_abnormally' })
  @IsString()
  estadoDaSessao!: string;

  @ApiProperty({
    example: 'O agente parou de responder depois de um tool call de 90 s.',
  })
  @IsString()
  analise!: string;
}

export class HypothesisDraftDto {
  @ApiProperty({ example: 'dev-api' })
  @IsString()
  agenteAlvo!: string;

  @ApiProperty({ example: 'O agente reabriu a mesma tarefa três vezes.' })
  @IsString()
  observacao!: string;

  @ApiProperty({
    example: 'As instruções não dizem quando a tarefa está pronta.',
  })
  @IsString()
  hipotese!: string;

  @ApiProperty({ example: 'Acrescentar um critério de pronto explícito.' })
  @IsString()
  sugestao!: string;

  // Faixa também validada no domínio (hypothesis-evidence.ts) — aqui é só
  // a barreira de entrada do DTO; a regra de negócio mora no domínio.
  @ApiProperty({
    example: 72,
    minimum: 0,
    maximum: 100,
    description: 'Auto-relato do modelo, não medida.',
  })
  @IsInt()
  @Min(0)
  @Max(100)
  confiancaPercent!: number;

  @ApiProperty({
    example: ['01JC4Z8QK3M7YV2N5T9B0PXHRB'],
    description:
      'Pelo menos um, e cada um tem de EXISTIR nesta sessão. Evidência inventada é ' +
      'recusada com 400 — é o que separa hipótese de opinião.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  evidenceEventIds!: string[];

  @ApiPropertyOptional({
    type: HypothesisTerminationAnalysisDto,
    description: 'OBRIGATÓRIA quando `cause` indica término anormal.',
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
      'Os dois tiers usam modelos genuinamente diferentes; o custo diverge.',
  })
  @IsIn(['leve', 'pesada'])
  tier!: 'leve' | 'pesada';

  @ApiProperty({ enum: ['auto', 'manual'], example: 'auto' })
  @IsIn(['auto', 'manual'])
  triggeredBy!: 'auto' | 'manual';

  @ApiProperty({ example: 128, description: 'Tamanho do log analisado.' })
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
      'Causa CLASSIFICADA pelo engine. É ela, e não o status terminal, que decide se ' +
      '`terminationAnalysis` é obrigatória. Opcional para não quebrar engine antigo ' +
      'em rolling deploy.',
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
