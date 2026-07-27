import type {
  PsychologistAnalysis,
  PsychologistAnalysisTier,
  PsychologistAnalysisTrigger,
} from '../../domain/psychologist/psychologist-analysis.entity';

export interface NewPsychologistAnalysis {
  projectId: string;
  sessionId: string;
  tier: PsychologistAnalysisTier;
  triggeredBy: PsychologistAnalysisTrigger;
  supersedes?: string | null;
  eventCountAtAnalysis: number;
}

export abstract class PsychologistAnalysisRepository {
  abstract create(
    input: NewPsychologistAnalysis,
  ): Promise<PsychologistAnalysis>;
  // A análise "current" (não superseded) de uma sessão — no máximo uma,
  // garantido pelo índice parcial único do schema. null = sessão nunca
  // analisada com sucesso (ou toda análise anterior foi superseded, o
  // que não deveria acontecer sem uma nova current no lugar).
  abstract findCurrentBySession(
    sessionId: string,
  ): Promise<PsychologistAnalysis | null>;
  // Análises current do projeto, mais recentes primeiro — alimenta a faixa
  // de análises da seção Insights (tier + custo por sessão analisada).
  abstract listCurrentByProject(
    projectId: string,
  ): Promise<PsychologistAnalysis[]>;
  abstract markSuperseded(id: string): Promise<void>;
}
