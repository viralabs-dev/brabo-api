export type PsychologistAnalysisTier = 'leve' | 'pesada';
export type PsychologistAnalysisTrigger = 'auto' | 'manual';

// Uma linha por RUN de análise CONCLUÍDO COM SUCESSO — ver
// psychologist_analyses no schema.ts pro porquê de não haver status
// pending/failed aqui (run falho não grava linha, de propósito).
export interface PsychologistAnalysis {
  id: string;
  projectId: string;
  sessionId: string;
  tier: PsychologistAnalysisTier;
  triggeredBy: PsychologistAnalysisTrigger;
  supersedes: string | null;
  superseded: boolean;
  supersededAt: Date | null;
  eventCountAtAnalysis: number;
  createdAt: Date;
}

/**
 * Análise + o que o critério de aceite precisa ver: o custo real em
 * micro-USD somado de `token_usage` e quantas hipóteses ela rendeu. É o que
 * torna "custos distintos entre triagem leve e pesada" verificável — antes o
 * custo por análise era calculável mas não exposto por rota nenhuma.
 */
export interface PsychologistAnalysisWithCost extends PsychologistAnalysis {
  costMicros: number;
  hypothesisCount: number;
}
