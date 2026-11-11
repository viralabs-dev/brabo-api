import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { SessionRepository } from '../../ports/session-repository.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { PsychologistAnalysisRepository } from '../../ports/psychologist-analysis-repository.port';
import { PsychologistHypothesisRepository } from '../../ports/psychologist-hypothesis-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import {
  requiresTerminationAnalysis,
  validateHypothesisBatch,
} from '../../../domain/psychologist/hypothesis-evidence';
import type {
  HypothesisDraft,
  TerminationCause,
} from '../../../domain/psychologist/hypothesis-evidence';
import type {
  PsychologistAnalysisTier,
  PsychologistAnalysisTrigger,
} from '../../../domain/psychologist/psychologist-analysis.entity';
import type { PsychologistHypothesis } from '../../../domain/psychologist/psychologist-hypothesis.entity';

// RN-1076: cada item traz o ESCOPO. `produto` vira hipótese; `plataforma`
// vira sinal interno (só em sessão de teste) ou some.
export type EscopoDaHipotese = 'produto' | 'plataforma';
export type HypothesisProposal = HypothesisDraft & { escopo: EscopoDaHipotese };

export interface ProposeHypothesesInput {
  tier: PsychologistAnalysisTier;
  triggeredBy: PsychologistAnalysisTrigger;
  eventCount: number;
  // Classificada pelo engine a partir de sessions.termination_reason.
  // Ausente = engine antigo; cai no status terminal (ver
  // requiresTerminationAnalysis).
  cause?: TerminationCause;
  // `projects.sessao_de_teste`, enviada pelo engine (RN-1076).
  sessaoDeTeste: boolean;
  // Pode ser vazio: análise com zero hipóteses é válida.
  hypotheses: HypothesisProposal[];
}

export interface ProposeHypothesesResult {
  analysisId: string;
  hypotheses: PsychologistHypothesis[];
}

/**
 * Coração do domínio do Psicólogo (Fase 4b): valida que TODA evidência
 * referenciada aponta pra um event id REAL desta sessão (mesmo padrão de
 * CreateStoryUseCase pra business_rule_id) — lote inteiro rejeitado
 * atomicamente se qualquer hipótese falhar, mesma disciplina de
 * emit_artifact/emit_qa_verdict. A rejeição vira `BadRequestException`,
 * que o tool do engine transforma em `{:error, msg}` — o próximo
 * tool-result pro modelo, guiando a correção dentro do teto de
 * max_iterations ("até M tentativas").
 *
 * Reprocessamento (triggeredBy='manual' OU qualquer chamada quando já há
 * uma análise current) marca a análise anterior `superseded=true` (nunca
 * apaga) antes de inserir a nova — histórico preservado de graça.
 */
@Injectable()
export class ProposeHypothesesUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly sessions: SessionRepository,
    private readonly sessionEvents: SessionEventRepository,
    private readonly psychologistAnalyses: PsychologistAnalysisRepository,
    private readonly psychologistHypotheses: PsychologistHypothesisRepository,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    input: ProposeHypothesesInput,
  ): Promise<ProposeHypothesesResult> {
    const session = await this.sessions.findInProject(projectId, sessionId);
    if (!session) throw new NotFoundException('Sessão não encontrada');

    const knownEventIds = await this.resolveKnownEventIds(
      sessionId,
      input.hypotheses,
    );

    const validation = validateHypothesisBatch(
      input.hypotheses,
      knownEventIds,
      // A análise de término só é exigida em sessão de teste (RN-1076).
      input.sessaoDeTeste &&
        requiresTerminationAnalysis(
          input.cause,
          session.status === 'closed_abnormally',
        ),
    );
    if (!validation.ok) throw new BadRequestException(validation.reason);

    const actorId = input.tier === 'pesada' ? 'psicologo' : 'psicologo-leve';

    try {
      return await this.persist(projectId, sessionId, input, actorId);
    } catch (error) {
      // Duas análises `auto` concorrentes chegam aqui juntas: as duas veem
      // "sem análise current" e as duas inserem. O índice parcial único
      // (psychologist_analyses_current_idx) é a rede de segurança — o que
      // faltava era traduzir a violação num conflito legível em vez de
      // deixar escapar como 500. Quem perde a corrida não perde trabalho:
      // a análise vencedora já está gravada.
      if (isCurrentAnalysisConflict(error)) {
        throw new ConflictException(
          'esta sessão já tem uma análise current (corrida de análise concorrente)',
        );
      }
      throw error;
    }
  }

  private persist(
    projectId: string,
    sessionId: string,
    input: ProposeHypothesesInput,
    actorId: string,
  ): Promise<ProposeHypothesesResult> {
    return this.unitOfWork.runInTransaction(async () => {
      const existing =
        await this.psychologistAnalyses.findCurrentBySession(sessionId);
      if (existing) {
        await this.psychologistAnalyses.markSuperseded(existing.id);
      }

      const analysis = await this.psychologistAnalyses.create({
        projectId,
        sessionId,
        tier: input.tier,
        triggeredBy: input.triggeredBy,
        supersedes: existing?.id ?? null,
        eventCountAtAnalysis: input.eventCount,
      });

      const produto = input.hypotheses.filter((d) => d.escopo === 'produto');
      // Item de plataforma nunca vira hipótese; fora de sessão de teste some.
      const plataforma = input.sessaoDeTeste
        ? input.hypotheses.filter((d) => d.escopo === 'plataforma')
        : [];

      // Lote só de plataforma (ou vazio) não chama o repositório.
      const hypotheses =
        produto.length === 0
          ? []
          : await this.psychologistHypotheses.createMany(
              produto.map((draft) => ({
                projectId,
                sessionId,
                analysisId: analysis.id,
                agenteAlvo: draft.agenteAlvo,
                observacao: draft.observacao,
                hipotese: draft.hipotese,
                sugestao: draft.sugestao,
                confiancaPercent: draft.confiancaPercent,
                evidenceEventIds: draft.evidenceEventIds,
                terminationAnalysis: draft.terminationAnalysis ?? null,
              })),
            );

      for (const hypothesis of hypotheses) {
        await this.appendSessionEvent.execute(projectId, sessionId, {
          type: 'psychologist.hypothesis_proposed',
          actor: { kind: 'agent', id: actorId },
          payload: {
            hypothesisId: hypothesis.id,
            agenteAlvo: hypothesis.agenteAlvo,
            hipotese: hypothesis.hipotese,
            sugestao: hypothesis.sugestao,
            confiancaPercent: hypothesis.confiancaPercent,
            evidenceEventIds: hypothesis.evidenceEventIds,
            terminationAnalysis: hypothesis.terminationAnalysis,
          },
        });
      }

      // Sinal interno do TP-01: no log da sessão, fora do grafo e da fila da
      // Anamnese (não é linha de psychologist_hypotheses).
      for (const sinal of plataforma) {
        await this.appendSessionEvent.execute(projectId, sessionId, {
          type: 'psychologist.platform_signal',
          actor: { kind: 'agent', id: actorId },
          payload: {
            agenteAlvo: sinal.agenteAlvo,
            observacao: sinal.observacao,
            hipotese: sinal.hipotese,
            sugestao: sinal.sugestao,
            confiancaPercent: sinal.confiancaPercent,
            evidenceEventIds: sinal.evidenceEventIds,
            terminationAnalysis: sinal.terminationAnalysis ?? null,
          },
        });
      }

      await this.appendSessionEvent.execute(projectId, sessionId, {
        type: 'psychologist.analysis_completed',
        actor: { kind: 'agent', id: actorId },
        payload: {
          analysisId: analysis.id,
          tier: input.tier,
          hypothesisCount: hypotheses.length,
          platformSignalCount: plataforma.length,
          supersedesPrevious: existing !== null,
        },
      });

      return { analysisId: analysis.id, hypotheses };
    });
  }

  // Resolve quais evidenceEventIds referenciados no lote existem E
  // pertencem a ESTA sessão — ids inválidos simplesmente não entram no
  // set, e o validador de domínio rejeita a hipótese que os referencia.
  private async resolveKnownEventIds(
    sessionId: string,
    drafts: HypothesisProposal[],
  ): Promise<Set<string>> {
    const referencedIds = new Set<string>();
    for (const draft of drafts) {
      for (const id of draft.evidenceEventIds) referencedIds.add(id);
    }

    const known = new Set<string>();
    await Promise.all(
      Array.from(referencedIds).map(async (id) => {
        const event = await this.sessionEvents.findById(id);
        if (event && event.sessionId === sessionId) known.add(id);
      }),
    );
    return known;
  }
}

// Violação do índice parcial único de análise current. Postgres devolve
// 23505 com o nome da constraint; casar pelo NOME evita confundir com
// qualquer outro unique que apareça na mesma transação.
const CURRENT_ANALYSIS_INDEX = 'psychologist_analyses_current_idx';

function isCurrentAnalysisConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: string; constraint?: string };
  return (
    candidate.code === '23505' &&
    candidate.constraint === CURRENT_ANALYSIS_INDEX
  );
}
