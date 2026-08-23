import { ApiProperty } from '@nestjs/swagger';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';
import type { ProductMetricsReport } from '../../../../application/use-cases/backlog/list-product-metrics.use-case';
import type {
  EtapaFunil,
  FunilResultado,
  LeadTime,
  FrequenciaPorDia,
} from '../../../../application/services/funil-metrics';

/**
 * Resposta de `GET /internal/projects/:projectId/product-metrics`
 * (RN-407) — o relatório de funil/DORA parcial (ADR 0089) que o PO lê.
 * Os nomes em pt-BR (`etapa`, `sessoes`, `dia`…) são os MESMOS de
 * `apps/api/src/application/services/funil-metrics.ts`, de propósito:
 * são o mesmo fato que o relatório humano (`analise:funil`) já usa, e
 * traduzir aqui abriria uma segunda nomenclatura para divergir depois.
 */

export class ProductMetricsFunnelStageResponseDto implements Wire<EtapaFunil> {
  @ApiProperty({ example: 'sessão produziu commit' })
  etapa!: string;

  @ApiProperty({ example: 3 })
  sessoes!: number;

  @ApiProperty({
    example: 0.67,
    nullable: true,
    description: '`null` on the first stage — there is no "conversion from" anything.',
  })
  taxaDaEtapaAnterior!: number | null;
}
export const _chavesEtapaFunil: MesmasChaves<
  ProductMetricsFunnelStageResponseDto,
  EtapaFunil
> = true;

export class ProductMetricsFunnelResponseDto implements Wire<FunilResultado> {
  @ApiProperty({ type: [ProductMetricsFunnelStageResponseDto] })
  etapas!: ProductMetricsFunnelStageResponseDto[];

  @ApiProperty({ type: [String] })
  sessoesComCommit!: string[];

  @ApiProperty({ type: [String] })
  sessoesComPr!: string[];

  @ApiProperty({ type: [String] })
  sessoesComMerge!: string[];
}
export const _chavesFunil: MesmasChaves<
  ProductMetricsFunnelResponseDto,
  FunilResultado
> = true;

export class ProductMetricsLeadTimeResponseDto implements Wire<LeadTime> {
  @ApiProperty({ example: '01JC4Z0000SESSAO000000000001' })
  sessionId!: string;

  @ApiProperty({ example: '2026-08-01T10:00:00.000Z' })
  primeiroCommitEm!: string;

  @ApiProperty({ example: '2026-08-01T12:00:00.000Z' })
  primeiroMergeEm!: string;

  @ApiProperty({ example: 7200000 })
  leadTimeMs!: number;
}
export const _chavesLeadTime: MesmasChaves<
  ProductMetricsLeadTimeResponseDto,
  LeadTime
> = true;

export class ProductMetricsDeploymentDayResponseDto implements Wire<FrequenciaPorDia> {
  @ApiProperty({ example: '2026-08-01' })
  dia!: string;

  @ApiProperty({ example: 2 })
  merges!: number;
}
export const _chavesDeploymentDia: MesmasChaves<
  ProductMetricsDeploymentDayResponseDto,
  FrequenciaPorDia
> = true;

export class ProductMetricsProjectResponseDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  id!: string;

  @ApiProperty({ example: 'exp003' })
  name!: string;
}

export class ProductMetricsLeadTimesResponseDto implements Wire<
  ProductMetricsReport['leadTimes']
> {
  @ApiProperty({ type: [ProductMetricsLeadTimeResponseDto] })
  perSession!: ProductMetricsLeadTimeResponseDto[];

  @ApiProperty({
    example: 7200000,
    nullable: true,
    description:
      'Simple average in ms — `null` with no session having both a commit AND a merge.',
  })
  averageMs!: number | null;
}
export const _chavesLeadTimes: MesmasChaves<
  ProductMetricsLeadTimesResponseDto,
  ProductMetricsReport['leadTimes']
> = true;

export class ProductMetricsResponseDto implements Wire<ProductMetricsReport> {
  @ApiProperty({ type: ProductMetricsProjectResponseDto })
  project!: ProductMetricsProjectResponseDto;

  @ApiProperty({
    example: 18,
    description:
      'Git actions considered (git_commit/pr_open/git_merge, any status).',
  })
  totalActionsConsidered!: number;

  @ApiProperty({ type: ProductMetricsFunnelResponseDto })
  funnel!: ProductMetricsFunnelResponseDto;

  @ApiProperty({ type: ProductMetricsLeadTimesResponseDto })
  leadTimes!: ProductMetricsLeadTimesResponseDto;

  @ApiProperty({ type: [ProductMetricsDeploymentDayResponseDto] })
  deploymentFrequency!: ProductMetricsDeploymentDayResponseDto[];
}
export const _chavesProductMetrics: MesmasChaves<
  ProductMetricsResponseDto,
  ProductMetricsReport
> = true;
