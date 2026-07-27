import { describe, it, expect } from 'vitest';
import { GetPsychologistContextUseCase } from '../../../../src/application/use-cases/execution/get-psychologist-context.use-case';
import type { SessionRepository } from '../../../../src/application/ports/session-repository.port';
import type { SessionEventRepository } from '../../../../src/application/ports/session-event-repository.port';
import type { PsychologistAnalysisRepository } from '../../../../src/application/ports/psychologist-analysis-repository.port';
import type { PsychologistHypothesisRepository } from '../../../../src/application/ports/psychologist-hypothesis-repository.port';
import type { Session } from '../../../../src/domain/sessions/session.entity';
import type { SessionEvent } from '../../../../src/domain/sessions/session-event.entity';
import type { PsychologistAnalysis } from '../../../../src/domain/psychologist/psychologist-analysis.entity';
import type { PsychologistHypothesis } from '../../../../src/domain/psychologist/psychologist-hypothesis.entity';

const now = new Date();

function buildSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    projectId: 'proj-1',
    createdBy: 'user-1',
    status: 'closed',
    nextSeq: 10,
    createdAt: now,
    updatedAt: now,
    closedAt: now,
    terminationReason: null,
  traceParent: null,
    ...overrides,
  };
}

function buildHarness(opts: {
  session?: Session | null;
  currentAnalysis?: PsychologistAnalysis | null;
  businessRuleEvents?: SessionEvent[];
  priorHypotheses?: PsychologistHypothesis[];
}) {
  const session = opts.session === undefined ? buildSession() : opts.session;
  const currentAnalysis =
    opts.currentAnalysis === undefined ? null : opts.currentAnalysis;
  const businessRuleEvents = opts.businessRuleEvents ?? [];
  const priorHypotheses = opts.priorHypotheses ?? [];

  const sessions = {
    findInProject: () => Promise.resolve(session),
  } as unknown as SessionRepository;

  const sessionEvents = {
    listByTypeForProject: () => Promise.resolve(businessRuleEvents),
  } as unknown as SessionEventRepository;

  const psychologistAnalyses = {
    findCurrentBySession: () => Promise.resolve(currentAnalysis),
  } as unknown as PsychologistAnalysisRepository;

  const psychologistHypotheses = {
    listNonDismissedByProject: () => Promise.resolve(priorHypotheses),
  } as unknown as PsychologistHypothesisRepository;

  const useCase = new GetPsychologistContextUseCase(
    sessions,
    sessionEvents,
    psychologistAnalyses,
    psychologistHypotheses,
  );

  return { useCase };
}

describe('GetPsychologistContextUseCase', () => {
  it('alreadyAnalyzed é false quando não há análise current', async () => {
    const { useCase } = buildHarness({});
    const ctx = await useCase.execute('proj-1', 'sess-1');
    expect(ctx.alreadyAnalyzed).toBe(false);
  });

  it('alreadyAnalyzed é true quando já existe análise current pra sessão', async () => {
    const { useCase } = buildHarness({
      currentAnalysis: {
        id: 'analysis-1',
        projectId: 'proj-1',
        sessionId: 'sess-1',
        tier: 'pesada',
        triggeredBy: 'auto',
        supersedes: null,
        superseded: false,
        supersededAt: null,
        eventCountAtAnalysis: 25,
        createdAt: now,
      },
    });
    const ctx = await useCase.execute('proj-1', 'sess-1');
    expect(ctx.alreadyAnalyzed).toBe(true);
  });

  it('traz o terminationReason da sessão', async () => {
    const { useCase } = buildHarness({
      session: buildSession({
        status: 'closed_abnormally',
        terminationReason: 'killed',
      }),
    });
    const ctx = await useCase.execute('proj-1', 'sess-1');
    expect(ctx.sessionStatus).toBe('closed_abnormally');
    expect(ctx.terminationReason).toBe('killed');
  });

  it('hipóteses descartadas já vêm excluídas pelo repositório (listNonDismissedByProject)', async () => {
    const { useCase } = buildHarness({
      priorHypotheses: [
        {
          id: 'hyp-1',
          projectId: 'proj-1',
          sessionId: 'sess-0',
          analysisId: 'analysis-0',
          agenteAlvo: 'dev-api',
          observacao: 'obs',
          hipotese: 'hip',
          sugestao: 'sug',
          confiancaPercent: 80,
          evidenceEventIds: ['evt-1'],
          terminationAnalysis: null,
          status: 'proposed',
          decidedBy: null,
          decidedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    const ctx = await useCase.execute('proj-1', 'sess-1');
    expect(ctx.priorHypotheses).toHaveLength(1);
    expect(ctx.priorHypotheses[0].agenteAlvo).toBe('dev-api');
  });
});
