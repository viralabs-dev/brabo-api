import { Injectable, NotFoundException } from '@nestjs/common';
import { SessionRepository } from '../../ports/session-repository.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { PsychologistAnalysisRepository } from '../../ports/psychologist-analysis-repository.port';
import { PsychologistHypothesisRepository } from '../../ports/psychologist-hypothesis-repository.port';
import type { SessionStatus } from '../../../domain/sessions/session-state-machine';

export interface PsychologistContextBusinessRule {
  id: string;
  title: string;
}

export interface PsychologistContextPriorHypothesis {
  agenteAlvo: string;
  hipotese: string;
  sugestao: string;
  confiancaPercent: number;
}

export interface PsychologistContext {
  // Já existe uma análise CURRENT (não superseded) pra essa sessão —
  // o worker usa isso pra idempotência (curto-circuita no caminho
  // automático, sem gastar nada).
  alreadyAnalyzed: boolean;
  sessionStatus: SessionStatus;
  terminationReason: string | null;
  businessRules: PsychologistContextBusinessRule[];
  priorHypotheses: PsychologistContextPriorHypothesis[];
}

/**
 * Contexto rico do Psicólogo (Fase 4b): monta em UMA chamada o que o
 * PsychologistWorker precisa antes de rodar o ToolLoop — regras de
 * negócio do PROJETO (via listByTypeForProject, mesmo padrão de
 * get-coverage.use-case.ts), hipóteses anteriores NÃO descartadas do
 * projeto, e se a sessão já foi analisada (idempotência) + o motivo de
 * término (pra seção adicional de causa em términos anormais). O log
 * completo de eventos da sessão o engine já lê direto do Postgres
 * (Engine.SessionEvents.Event.list/1) — não duplicado aqui.
 */
@Injectable()
export class GetPsychologistContextUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly sessionEvents: SessionEventRepository,
    private readonly psychologistAnalyses: PsychologistAnalysisRepository,
    private readonly psychologistHypotheses: PsychologistHypothesisRepository,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
  ): Promise<PsychologistContext> {
    const session = await this.sessions.findInProject(projectId, sessionId);
    if (!session) throw new NotFoundException('Sessão não encontrada');

    const [currentAnalysis, businessRuleEvents, priorHypotheses] =
      await Promise.all([
        this.psychologistAnalyses.findCurrentBySession(sessionId),
        this.sessionEvents.listByTypeForProject(
          projectId,
          'artifact.business_rule',
        ),
        this.psychologistHypotheses.listNonDismissedByProject(projectId),
      ]);

    const businessRules: PsychologistContextBusinessRule[] =
      businessRuleEvents.map((e) => ({
        id: e.id,
        title:
          (e.payload as { title?: string }).title ?? '(regra sem título)',
      }));

    return {
      alreadyAnalyzed: currentAnalysis !== null,
      sessionStatus: session.status,
      terminationReason: session.terminationReason,
      businessRules,
      priorHypotheses: priorHypotheses.map((h) => ({
        agenteAlvo: h.agenteAlvo,
        hipotese: h.hipotese,
        sugestao: h.sugestao,
        confiancaPercent: h.confiancaPercent,
      })),
    };
  }
}
