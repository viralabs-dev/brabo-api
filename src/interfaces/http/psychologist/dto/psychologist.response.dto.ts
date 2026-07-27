import { ApiProperty } from '@nestjs/swagger';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';
import { HYPOTHESIS_STATUSES } from '../../../../domain/psychologist/hypothesis-lifecycle';
import type {
  HypothesisTerminationAnalysis,
  PsychologistHypothesis,
} from '../../../../domain/psychologist/psychologist-hypothesis.entity';
import type { PsychologistAnalysisWithCost } from '../../../../domain/psychologist/psychologist-analysis.entity';

/**
 * Respostas do Psicólogo (Fase 7b, item 6).
 *
 * O Psicólogo é SÓ LEITURA: ele observa o event log e propõe hipóteses sobre o
 * comportamento dos agentes. Aceitar ou descartar uma hipótese não é
 * `proposed_action` — nada aqui tem efeito externo.
 */

export class AnaliseDeTerminoResponseDto implements Wire<HypothesisTerminationAnalysis> {
  @ApiProperty({
    example: 'heartbeat_timeout',
    description:
      'A ORIGEM da falha, nunca deduzida por eliminação (lição do ADR 0020).',
  })
  causa!: string;

  @ApiProperty({ example: 'closed_abnormally' })
  estadoDaSessao!: string;

  @ApiProperty({
    example: 'O agente parou de responder depois de um tool call de 90 s.',
  })
  analise!: string;
}
export const _chavesAnaliseTermino: MesmasChaves<
  AnaliseDeTerminoResponseDto,
  HypothesisTerminationAnalysis
> = true;

export class HypothesisResponseDto implements Wire<PsychologistHypothesis> {
  @ApiProperty({ example: '01JC4Z0000HIPOTESE000000001' })
  id!: string;

  @ApiProperty({ example: '01JC4Z0000PROJETO0000000001' })
  projectId!: string;

  @ApiProperty({ example: '01JC4Z8QK3M7YV2N5T9B0PXHRA' })
  sessionId!: string;

  @ApiProperty({
    example: '01JC4Z0000ANALISE0000000001',
    description: 'A rodada de análise que gerou esta hipótese.',
  })
  analysisId!: string;

  @ApiProperty({
    example: 'dev-api',
    description: 'Sobre qual agente é a hipótese.',
  })
  agenteAlvo!: string;

  @ApiProperty({ example: 'O agente reabriu a mesma tarefa três vezes.' })
  observacao!: string;

  @ApiProperty({
    example: 'As instruções não dizem quando considerar a tarefa pronta.',
  })
  hipotese!: string;

  @ApiProperty({
    example: 'Acrescentar um critério de pronto explícito à instrução.',
  })
  sugestao!: string;

  @ApiProperty({
    example: 72,
    minimum: 0,
    maximum: 100,
    description:
      'Confiança declarada pelo próprio modelo. Não é medida, é auto-relato.',
  })
  confiancaPercent!: number;

  @ApiProperty({
    example: ['01JC4Z8QK3M7YV2N5T9B0PXHRB'],
    description:
      'Eventos do log que sustentam a hipótese. É por eles que a evidência é ' +
      'auditável em vez de acreditada.',
  })
  evidenceEventIds!: string[];

  @ApiProperty({
    type: AnaliseDeTerminoResponseDto,
    nullable: true,
    description:
      'Presente só nas hipóteses sobre sessão terminada de forma anormal.',
  })
  terminationAnalysis!: AnaliseDeTerminoResponseDto | null;

  @ApiProperty({ enum: HYPOTHESIS_STATUSES, example: 'proposed' })
  status!: Wire<PsychologistHypothesis>['status'];

  @ApiProperty({ example: null, nullable: true })
  decidedBy!: string | null;

  @ApiProperty({ example: null, format: 'date-time', nullable: true })
  decidedAt!: string | null;

  @ApiProperty({ example: '2026-07-26T18:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-26T18:00:00.000Z', format: 'date-time' })
  updatedAt!: string;
}
export const _chavesHipotese: MesmasChaves<
  HypothesisResponseDto,
  PsychologistHypothesis
> = true;

/** Uma rodada de análise, com o custo real que ela teve. */
export class PsychologistAnalysisResponseDto implements Wire<PsychologistAnalysisWithCost> {
  @ApiProperty({ example: '01JC4Z0000ANALISE0000000001' })
  id!: string;

  @ApiProperty({ example: '01JC4Z0000PROJETO0000000001' })
  projectId!: string;

  @ApiProperty({ example: '01JC4Z8QK3M7YV2N5T9B0PXHRA' })
  sessionId!: string;

  @ApiProperty({
    enum: ['leve', 'pesada'],
    example: 'leve',
    description:
      'Tier da triagem. Os dois usam modelos GENUINAMENTE diferentes — é isso que ' +
      'faz o custo divergir de verdade em vez de na etiqueta.',
  })
  tier!: Wire<PsychologistAnalysisWithCost>['tier'];

  @ApiProperty({
    enum: ['auto', 'manual'],
    example: 'auto',
    description: '`manual` é a reanálise pedida por gente.',
  })
  triggeredBy!: Wire<PsychologistAnalysisWithCost>['triggeredBy'];

  @ApiProperty({
    example: null,
    nullable: true,
    description: 'Id da análise que esta substitui.',
  })
  supersedes!: string | null;

  @ApiProperty({ example: false })
  superseded!: boolean;

  @ApiProperty({ example: null, format: 'date-time', nullable: true })
  supersededAt!: string | null;

  @ApiProperty({
    example: 128,
    description:
      'Tamanho do log no momento da análise — o recorte que ela enxergou.',
  })
  eventCountAtAnalysis!: number;

  @ApiProperty({ example: '2026-07-26T18:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({
    example: 4200,
    description:
      'Custo real em micro-USD, somado do `token_usage` da rodada. Só há linha aqui ' +
      'para run CONCLUÍDO: run que falhou não grava, de propósito.',
  })
  costMicros!: number;

  @ApiProperty({
    example: 3,
    description: 'Quantas hipóteses a rodada rendeu.',
  })
  hypothesisCount!: number;
}
export const _chavesAnalise: MesmasChaves<
  PsychologistAnalysisResponseDto,
  PsychologistAnalysisWithCost
> = true;
