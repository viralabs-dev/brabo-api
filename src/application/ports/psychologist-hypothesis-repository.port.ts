import type {
  HypothesisTerminationAnalysis,
  PsychologistHypothesis,
} from '../../domain/psychologist/psychologist-hypothesis.entity';
import type { HypothesisStatus } from '../../domain/psychologist/hypothesis-lifecycle';

export interface NewPsychologistHypothesis {
  projectId: string;
  sessionId: string;
  analysisId: string;
  agenteAlvo: string;
  observacao: string;
  hipotese: string;
  sugestao: string;
  confiancaPercent: number;
  evidenceEventIds: string[];
  terminationAnalysis?: HypothesisTerminationAnalysis | null;
}

export abstract class PsychologistHypothesisRepository {
  abstract createMany(
    inputs: NewPsychologistHypothesis[],
  ): Promise<PsychologistHypothesis[]>;
  abstract findById(id: string): Promise<PsychologistHypothesis | null>;
  abstract updateStatus(
    id: string,
    status: Extract<HypothesisStatus, 'accepted' | 'dismissed'>,
    decidedBy: string,
    decidedAt: Date,
  ): Promise<PsychologistHypothesis>;
  // Hipóteses de análises CURRENT (não superseded) do projeto — pra
  // seção Insights da UI, agrupamento por agenteAlvo fica no front.
  abstract listCurrentByProject(
    projectId: string,
  ): Promise<PsychologistHypothesis[]>;
  // "Hipóteses anteriores não descartadas" (contexto do Psicólogo,
  // GetPsychologistContextUseCase) — mesmo escopo de listCurrentByProject,
  // já filtrado por status != 'dismissed'.
  abstract listNonDismissedByProject(
    projectId: string,
  ): Promise<PsychologistHypothesis[]>;
}
