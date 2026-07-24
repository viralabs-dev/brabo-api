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
  eventCountAtAnalysis: number;
  createdAt: Date;
}
