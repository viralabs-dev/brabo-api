import { Injectable } from '@nestjs/common';
import { PsychologistAnalysisRepository } from '../../ports/psychologist-analysis-repository.port';
import { PsychologistHypothesisRepository } from '../../ports/psychologist-hypothesis-repository.port';
import { GetPsychologistAnalysisCostUseCase } from './get-psychologist-analysis-cost.use-case';
import type { PsychologistAnalysisWithCost } from '../../../domain/psychologist/psychologist-analysis.entity';

/**
 * Análises current do projeto com tier, contagem de hipóteses e CUSTO REAL
 * (Fase 4b — fechamento).
 *
 * É esta rota que torna o critério de aceite "custos distintos entre triagem
 * leve e pesada visíveis no metering" verificável: o custo já era calculável
 * (`GetPsychologistAnalysisCostUseCase`, somando `token_usage` pelos actor
 * ids `psicologo`/`psicologo-leve`), mas nenhum controller o injetava — o
 * número existia e não aparecia em lugar nenhum.
 *
 * O custo é por SESSÃO analisada, não por linha de análise: `token_usage`
 * grava por sessão+ator, sem referência à análise. Numa sessão reanalisada,
 * o número é o acumulado das passadas — o que é o certo pra "quanto o
 * Psicólogo gastou nesta sessão", e é por isso que o campo se chama
 * `costMicros` e não `analysisCostMicros`.
 */
@Injectable()
export class ListPsychologistAnalysesUseCase {
  constructor(
    private readonly analyses: PsychologistAnalysisRepository,
    private readonly hypotheses: PsychologistHypothesisRepository,
    private readonly analysisCost: GetPsychologistAnalysisCostUseCase,
  ) {}

  async execute(projectId: string): Promise<PsychologistAnalysisWithCost[]> {
    const current = await this.analyses.listCurrentByProject(projectId);
    if (current.length === 0) return [];

    const counts = await this.hypotheses.countByAnalysisIds(
      current.map((a) => a.id),
    );

    const costs = await Promise.all(
      current.map((a) => this.analysisCost.execute(a.sessionId)),
    );

    return current.map((analysis, i) => ({
      ...analysis,
      costMicros: costs[i],
      hypothesisCount: counts[analysis.id] ?? 0,
    }));
  }
}
