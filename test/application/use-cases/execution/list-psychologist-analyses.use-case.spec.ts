import { describe, it, expect, vi } from 'vitest';
import { ListPsychologistAnalysesUseCase } from '../../../../src/application/use-cases/execution/list-psychologist-analyses.use-case';
import { GetPsychologistAnalysisCostUseCase } from '../../../../src/application/use-cases/execution/get-psychologist-analysis-cost.use-case';
import type { PsychologistAnalysisRepository } from '../../../../src/application/ports/psychologist-analysis-repository.port';
import type { PsychologistHypothesisRepository } from '../../../../src/application/ports/psychologist-hypothesis-repository.port';
import type { TokenUsageRepository } from '../../../../src/application/ports/token-usage-repository.port';
import type { PsychologistAnalysis } from '../../../../src/domain/psychologist/psychologist-analysis.entity';

const now = new Date();

function buildAnalysis(
  overrides: Partial<PsychologistAnalysis> = {},
): PsychologistAnalysis {
  return {
    id: 'analysis-leve',
    projectId: 'proj-1',
    sessionId: 'sess-leve',
    tier: 'leve',
    triggeredBy: 'auto',
    supersedes: null,
    superseded: false,
    supersededAt: null,
    eventCountAtAnalysis: 4,
    createdAt: now,
    ...overrides,
  };
}

function buildHarness(opts: {
  analyses: PsychologistAnalysis[];
  counts?: Record<string, number>;
  costBySession?: Record<string, number>;
}) {
  const analyses = {
    listCurrentByProject: () => Promise.resolve(opts.analyses),
  } as unknown as PsychologistAnalysisRepository;

  const hypotheses = {
    countByAnalysisIds: () => Promise.resolve(opts.counts ?? {}),
  } as unknown as PsychologistHypothesisRepository;

  const sumBySessionAndActorIds = vi.fn((sessionId: string) =>
    Promise.resolve(opts.costBySession?.[sessionId] ?? 0),
  );
  const tokenUsage = {
    sumBySessionAndActorIds,
  } as unknown as TokenUsageRepository;

  return {
    useCase: new ListPsychologistAnalysesUseCase(
      analyses,
      hypotheses,
      new GetPsychologistAnalysisCostUseCase(tokenUsage),
    ),
    sumBySessionAndActorIds,
  };
}

describe('ListPsychologistAnalysesUseCase', () => {
  it('projeto sem análise: lista vazia sem consultar custo', async () => {
    const { useCase, sumBySessionAndActorIds } = buildHarness({ analyses: [] });

    expect(await useCase.execute('proj-1')).toEqual([]);
    expect(sumBySessionAndActorIds).not.toHaveBeenCalled();
  });

  it('custo da triagem leve fica abaixo do da pesada — é o critério de aceite', async () => {
    // Modelos diferentes por tier (psicologo-leve -> barato, psicologo ->
    // forte) fazem o custo divergir de verdade no token_usage; esta rota é
    // o que torna isso VISÍVEL.
    const { useCase } = buildHarness({
      analyses: [
        buildAnalysis(),
        buildAnalysis({
          id: 'analysis-pesada',
          sessionId: 'sess-pesada',
          tier: 'pesada',
          eventCountAtAnalysis: 42,
        }),
      ],
      counts: { 'analysis-leve': 1, 'analysis-pesada': 3 },
      costBySession: { 'sess-leve': 900, 'sess-pesada': 41_500 },
    });

    const [leve, pesada] = await useCase.execute('proj-1');

    expect(leve.tier).toBe('leve');
    expect(leve.costMicros).toBe(900);
    expect(leve.hypothesisCount).toBe(1);

    expect(pesada.tier).toBe('pesada');
    expect(pesada.costMicros).toBe(41_500);
    expect(pesada.hypothesisCount).toBe(3);

    expect(leve.costMicros).toBeLessThan(pesada.costMicros);
  });

  it('custo é somado pela SESSÃO analisada, não por análise', async () => {
    // token_usage grava por sessão+ator, sem referência à análise.
    const { useCase, sumBySessionAndActorIds } = buildHarness({
      analyses: [buildAnalysis()],
      costBySession: { 'sess-leve': 1_234 },
    });

    const [analysis] = await useCase.execute('proj-1');

    expect(sumBySessionAndActorIds).toHaveBeenCalledWith('sess-leve', [
      'psicologo',
      'psicologo-leve',
    ]);
    expect(analysis.costMicros).toBe(1_234);
  });

  it('análise sem hipótese contabilizada cai em zero, não em undefined', async () => {
    const { useCase } = buildHarness({ analyses: [buildAnalysis()] });

    const [analysis] = await useCase.execute('proj-1');

    expect(analysis.hypothesisCount).toBe(0);
    expect(analysis.costMicros).toBe(0);
  });
});
