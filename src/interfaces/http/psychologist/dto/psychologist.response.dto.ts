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
      'The ORIGIN of the failure, never deduced by elimination (lesson from ADR 0020).',
  })
  causa!: string;

  @ApiProperty({ example: 'closed_abnormally' })
  estadoDaSessao!: string;

  @ApiProperty({
    example: 'The agent stopped responding after a 90s tool call.',
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
    description: 'The analysis round that generated this hypothesis.',
  })
  analysisId!: string;

  @ApiProperty({
    example: 'dev-api',
    description: 'Which agent the hypothesis is about.',
  })
  agenteAlvo!: string;

  @ApiProperty({ example: 'The agent reopened the same task three times.' })
  observacao!: string;

  @ApiProperty({
    example: "The instructions don't say when to consider the task done.",
  })
  hipotese!: string;

  @ApiProperty({
    example: 'Add an explicit definition-of-done criterion to the instruction.',
  })
  sugestao!: string;

  @ApiProperty({
    example: 72,
    minimum: 0,
    maximum: 100,
    description:
      'Confidence declared by the model itself. Not a measurement, a self-report.',
  })
  confiancaPercent!: number;

  @ApiProperty({
    example: ['01JC4Z8QK3M7YV2N5T9B0PXHRB'],
    description:
      'Log events that support the hypothesis. This is what makes the evidence ' +
      'auditable instead of taken on faith.',
  })
  evidenceEventIds!: string[];

  @ApiProperty({
    type: AnaliseDeTerminoResponseDto,
    nullable: true,
    description:
      'Present only on hypotheses about an abnormally terminated session.',
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
      'Triage tier. The two use GENUINELY different models — this is what makes ' +
      'the cost actually diverge instead of just the label.',
  })
  tier!: Wire<PsychologistAnalysisWithCost>['tier'];

  @ApiProperty({
    enum: ['auto', 'manual'],
    example: 'auto',
    description: '`manual` is the reanalysis requested by a human.',
  })
  triggeredBy!: Wire<PsychologistAnalysisWithCost>['triggeredBy'];

  @ApiProperty({
    example: null,
    nullable: true,
    description: 'Id of the analysis this one replaces.',
  })
  supersedes!: string | null;

  @ApiProperty({ example: false })
  superseded!: boolean;

  @ApiProperty({ example: null, format: 'date-time', nullable: true })
  supersededAt!: string | null;

  @ApiProperty({
    example: 128,
    description: 'Log size at the time of the analysis — the snapshot it saw.',
  })
  eventCountAtAnalysis!: number;

  @ApiProperty({ example: '2026-07-26T18:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({
    example: 4200,
    description:
      "Real cost in micro-USD, summed from the round's `token_usage`. There is " +
      'only a row here for a COMPLETED run: a failed run does not record one, on purpose.',
  })
  costMicros!: number;

  @ApiProperty({
    example: 3,
    description: 'How many hypotheses the round yielded.',
  })
  hypothesisCount!: number;
}
export const _chavesAnalise: MesmasChaves<
  PsychologistAnalysisResponseDto,
  PsychologistAnalysisWithCost
> = true;
