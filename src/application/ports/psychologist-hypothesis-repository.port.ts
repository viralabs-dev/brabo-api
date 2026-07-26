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
  /**
   * Compare-and-swap: só sai de `proposed`. Devolve `null` quando a linha
   * já foi decidida — a checagem no use case sozinha é read-then-write, e
   * dois cliques simultâneos passavam os dois. Quem perde a corrida vira
   * 400, não uma segunda transição silenciosa.
   */
  abstract updateStatusIfProposed(
    id: string,
    status: Extract<HypothesisStatus, 'accepted' | 'dismissed'>,
    decidedBy: string,
    decidedAt: Date,
  ): Promise<PsychologistHypothesis | null>;
  // Quantas hipóteses cada análise rendeu, por analysisId — usado na faixa
  // de análises do Insights (uma query, não N).
  abstract countByAnalysisIds(
    analysisIds: string[],
  ): Promise<Record<string, number>>;
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
