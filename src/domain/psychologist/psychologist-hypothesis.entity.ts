import type { HypothesisStatus } from './hypothesis-lifecycle';

export interface HypothesisTerminationAnalysis {
  causa: string;
  estadoDaSessao: string;
  analise: string;
}

export interface PsychologistHypothesis {
  id: string;
  projectId: string;
  sessionId: string;
  analysisId: string;
  agenteAlvo: string;
  observacao: string;
  hipotese: string;
  sugestao: string;
  confiancaPercent: number;
  evidenceEventIds: string[];
  terminationAnalysis: HypothesisTerminationAnalysis | null;
  status: HypothesisStatus;
  decidedBy: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
