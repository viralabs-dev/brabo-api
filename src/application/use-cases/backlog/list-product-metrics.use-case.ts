import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  DRIZZLE,
  type DrizzleDb,
} from '../../../infrastructure/persistence/drizzle/drizzle-client';
import { ProjectRepository } from '../../ports/project-repository.port';
import {
  buscarAcoesGitDoFunil,
  calcularFunil,
  calcularLeadTimes,
  leadTimeMedioMs,
  deploymentFrequencyPorDia,
  type FunilResultado,
  type LeadTime,
  type FrequenciaPorDia,
} from '../../services/funil-metrics';

export interface ProductMetricsReport {
  project: { id: string; name: string };
  totalActionsConsidered: number;
  funnel: FunilResultado;
  leadTimes: {
    perSession: LeadTime[];
    averageMs: number | null;
  };
  deploymentFrequency: FrequenciaPorDia[];
}

/**
 * O relatório de funil/DORA parcial (`analise:funil`, ADR 0089), agora
 * LEGÍVEL pelo PO ([RN-407](../../../../../../docs/business-rules.md#rn-407)) —
 * o mesmo padrão de `ListBusinessRulesUseCase`/`ListBacklogUseCase`
 * (RN-164): leitura escopada ao PROJETO, sem efeito externo.
 *
 * `docs/fluxo.yml` (papel `po`, entrada `metricas-de-produto`) declarava
 * `status: lacuna` — o dado já existia (o script `analise:funil` funciona
 * desde o ADR 0089), só faltava o MECANISMO de leitura. Esta é a última
 * pendência da auditoria fluxo.yml × código (item B4,
 * docs/explanation/auditoria-fluxo-vs-codigo.md), e fecha a tabela
 * "Backlog do modelo de time" por completo.
 *
 * O CÁLCULO é o mesmo do script — `calcularFunil`/`calcularLeadTimes`/
 * `leadTimeMedioMs`/`deploymentFrequencyPorDia` e a query
 * `buscarAcoesGitDoFunil`, todos em
 * `../../services/funil-metrics.ts` — para que a leitura do PO e o
 * relatório humano nunca divirjam do mesmo fato.
 */
@Injectable()
export class ListProductMetricsUseCase {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly projects: ProjectRepository,
  ) {}

  async execute(projectId: string): Promise<ProductMetricsReport> {
    const project = await this.projects.findById(projectId);
    if (!project) {
      throw new NotFoundException(`projeto ${projectId} não existe`);
    }

    const acoes = await buscarAcoesGitDoFunil(this.db, projectId);
    const funnel = calcularFunil(acoes);
    const leadTimes = calcularLeadTimes(acoes);
    const averageMs = leadTimeMedioMs(leadTimes);
    const deploymentFrequency = deploymentFrequencyPorDia(acoes);

    return {
      project: { id: project.id, name: project.name },
      totalActionsConsidered: acoes.length,
      funnel,
      leadTimes: { perSession: leadTimes, averageMs },
      deploymentFrequency,
    };
  }
}
