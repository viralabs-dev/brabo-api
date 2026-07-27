import { describe, it, expect, vi } from 'vitest';
import { ProposeHypothesesUseCase } from '../../../../src/application/use-cases/execution/propose-hypotheses.use-case';
import type { UnitOfWork } from '../../../../src/application/ports/unit-of-work.port';
import type { SessionRepository } from '../../../../src/application/ports/session-repository.port';
import type { SessionEventRepository } from '../../../../src/application/ports/session-event-repository.port';
import type { PsychologistAnalysisRepository } from '../../../../src/application/ports/psychologist-analysis-repository.port';
import type { PsychologistHypothesisRepository } from '../../../../src/application/ports/psychologist-hypothesis-repository.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { Session } from '../../../../src/domain/sessions/session.entity';
import type { SessionEvent } from '../../../../src/domain/sessions/session-event.entity';
import type { PsychologistAnalysis } from '../../../../src/domain/psychologist/psychologist-analysis.entity';
import type { HypothesisDraft } from '../../../../src/domain/psychologist/hypothesis-evidence';

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

function buildEvent(overrides: Partial<SessionEvent> = {}): SessionEvent {
  return {
    id: 'evt-1',
    sessionId: 'sess-1',
    seq: 1,
    type: 'chat.message',
    actor: { kind: 'user', id: 'user-1' },
    payload: {},
    createdAt: now,
    ...overrides,
  };
}

function buildDraft(overrides: Partial<HypothesisDraft> = {}): HypothesisDraft {
  return {
    agenteAlvo: 'dev-api',
    observacao: 'observação',
    hipotese: 'hipótese',
    sugestao: 'sugestão',
    confiancaPercent: 70,
    evidenceEventIds: ['evt-1'],
    terminationAnalysis: null,
    ...overrides,
  };
}

function buildHarness(opts: {
  session?: Session | null;
  events?: Record<string, SessionEvent | undefined>;
  existingAnalysis?: PsychologistAnalysis | null;
  createRejectsWith?: unknown;
}) {
  const session = opts.session === undefined ? buildSession() : opts.session;
  const events = opts.events ?? { 'evt-1': buildEvent() };
  const existingAnalysis =
    opts.existingAnalysis === undefined ? null : opts.existingAnalysis;

  const unitOfWork = {
    runInTransaction: (work: () => Promise<unknown>) => work(),
  } as unknown as UnitOfWork;

  const sessions = {
    findInProject: () => Promise.resolve(session),
  } as unknown as SessionRepository;

  const sessionEvents = {
    findById: (id: string) => Promise.resolve(events[id] ?? null),
  } as unknown as SessionEventRepository;

  const markSuperseded = vi.fn(() => Promise.resolve());
  const create = vi.fn((input: Record<string, unknown>) =>
    opts.createRejectsWith
      ? Promise.reject(opts.createRejectsWith)
      : Promise.resolve({
          id: 'analysis-1',
          projectId: input.projectId,
          sessionId: input.sessionId,
          tier: input.tier,
          triggeredBy: input.triggeredBy,
          supersedes: input.supersedes ?? null,
          superseded: false,
          eventCountAtAnalysis: input.eventCountAtAnalysis,
          createdAt: now,
        }),
  );
  const psychologistAnalyses = {
    findCurrentBySession: () => Promise.resolve(existingAnalysis),
    markSuperseded,
    create,
  } as unknown as PsychologistAnalysisRepository;

  const createMany = vi.fn((inputs: Record<string, unknown>[]) =>
    Promise.resolve(
      inputs.map((input, i) => ({
        id: `hyp-${i + 1}`,
        projectId: input.projectId,
        sessionId: input.sessionId,
        analysisId: input.analysisId,
        agenteAlvo: input.agenteAlvo,
        observacao: input.observacao,
        hipotese: input.hipotese,
        sugestao: input.sugestao,
        confiancaPercent: input.confiancaPercent,
        evidenceEventIds: input.evidenceEventIds,
        terminationAnalysis: input.terminationAnalysis ?? null,
        status: 'proposed',
        decidedBy: null,
        decidedAt: null,
        createdAt: now,
        updatedAt: now,
      })),
    ),
  );
  const psychologistHypotheses = {
    createMany,
  } as unknown as PsychologistHypothesisRepository;

  const appendEvent = vi.fn(() => Promise.resolve({}));
  const appendSessionEvent = {
    execute: appendEvent,
  } as unknown as AppendSessionEventUseCase;

  const useCase = new ProposeHypothesesUseCase(
    unitOfWork,
    sessions,
    sessionEvents,
    psychologistAnalyses,
    psychologistHypotheses,
    appendSessionEvent,
  );

  return {
    useCase,
    markSuperseded,
    create,
    createMany,
    appendEvent,
  };
}

describe('ProposeHypothesesUseCase', () => {
  it('caminho feliz: cria a análise + hipóteses, emite eventos, sem análise anterior', async () => {
    const { useCase, create, createMany, appendEvent, markSuperseded } =
      buildHarness({});

    const result = await useCase.execute('proj-1', 'sess-1', {
      tier: 'pesada',
      triggeredBy: 'auto',
      eventCount: 25,
      hypotheses: [buildDraft()],
    });

    expect(result.analysisId).toBe('analysis-1');
    expect(result.hypotheses).toHaveLength(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ supersedes: null, tier: 'pesada' }),
    );
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(markSuperseded).not.toHaveBeenCalled();
    // 1 evento por hipótese + 1 resumo da análise.
    expect(appendEvent).toHaveBeenCalledTimes(2);
    expect(appendEvent).toHaveBeenCalledWith(
      'proj-1',
      'sess-1',
      expect.objectContaining({ type: 'psychologist.hypothesis_proposed' }),
    );
    expect(appendEvent).toHaveBeenCalledWith(
      'proj-1',
      'sess-1',
      expect.objectContaining({ type: 'psychologist.analysis_completed' }),
    );
  });

  it('evidência inválida (event id inexistente): rejeita o lote inteiro, nada persiste', async () => {
    const { useCase, create, createMany, appendEvent } = buildHarness({
      events: {},
    });

    await expect(
      useCase.execute('proj-1', 'sess-1', {
        tier: 'pesada',
        triggeredBy: 'auto',
        eventCount: 25,
        hypotheses: [buildDraft({ evidenceEventIds: ['evt-fantasma'] })],
      }),
    ).rejects.toThrow();

    expect(create).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
    expect(appendEvent).not.toHaveBeenCalled();
  });

  it('event id de OUTRA sessão é tratado como inválido (rejeita)', async () => {
    const { useCase, create } = buildHarness({
      events: { 'evt-1': buildEvent({ sessionId: 'sess-outra' }) },
    });

    await expect(
      useCase.execute('proj-1', 'sess-1', {
        tier: 'pesada',
        triggeredBy: 'auto',
        eventCount: 25,
        hypotheses: [buildDraft()],
      }),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it('sessão closed_abnormally exige terminationAnalysis em ao menos uma hipótese', async () => {
    const { useCase, create } = buildHarness({
      session: buildSession({ status: 'closed_abnormally' }),
    });

    await expect(
      useCase.execute('proj-1', 'sess-1', {
        tier: 'pesada',
        triggeredBy: 'auto',
        eventCount: 25,
        hypotheses: [buildDraft({ terminationAnalysis: null })],
      }),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it('reanálise: marca a análise anterior superseded e referencia via supersedes', async () => {
    const existing: PsychologistAnalysis = {
      id: 'analysis-old',
      projectId: 'proj-1',
      sessionId: 'sess-1',
      tier: 'pesada',
      triggeredBy: 'auto',
      supersedes: null,
      superseded: false,
      supersededAt: null,
      eventCountAtAnalysis: 25,
      createdAt: now,
    };
    const { useCase, create, markSuperseded, appendEvent } = buildHarness({
      existingAnalysis: existing,
    });

    const result = await useCase.execute('proj-1', 'sess-1', {
      tier: 'pesada',
      triggeredBy: 'manual',
      eventCount: 30,
      hypotheses: [buildDraft()],
    });

    expect(markSuperseded).toHaveBeenCalledWith('analysis-old');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ supersedes: 'analysis-old' }),
    );
    expect(appendEvent).toHaveBeenCalledWith(
      'proj-1',
      'sess-1',
      expect.objectContaining({
        type: 'psychologist.analysis_completed',
        payload: expect.objectContaining({ supersedesPrevious: true }),
      }),
    );
    expect(result.analysisId).toBe('analysis-1');
  });

  it('causa timeout exige terminationAnalysis mesmo com a sessão fechada como closed', async () => {
    // heartbeat_timeout fecha como "closed" por decisão do Monitor; quem
    // manda é a CAUSA classificada pelo engine, não o status.
    const { useCase, create } = buildHarness({
      session: buildSession({
        status: 'closed',
        terminationReason: 'heartbeat_timeout',
      }),
    });

    await expect(
      useCase.execute('proj-1', 'sess-1', {
        tier: 'leve',
        triggeredBy: 'auto',
        eventCount: 4,
        cause: 'timeout',
        hypotheses: [buildDraft({ terminationAnalysis: null })],
      }),
    ).rejects.toThrow(/terminationAnalysis/);
    expect(create).not.toHaveBeenCalled();
  });

  it('causa normal não exige terminationAnalysis mesmo se o status disser anormal', async () => {
    const { useCase, create } = buildHarness({
      session: buildSession({ status: 'closed_abnormally' }),
    });

    await useCase.execute('proj-1', 'sess-1', {
      tier: 'leve',
      triggeredBy: 'auto',
      eventCount: 4,
      cause: 'normal',
      hypotheses: [buildDraft({ terminationAnalysis: null })],
    });

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('corrida de análise concorrente: violação do índice único vira 409, não 500', async () => {
    const { useCase } = buildHarness({
      // O outro run inseriu entre o findCurrentBySession e o insert deste.
      createRejectsWith: Object.assign(new Error('duplicate key value'), {
        code: '23505',
        constraint: 'psychologist_analyses_current_idx',
      }),
    });

    await expect(
      useCase.execute('proj-1', 'sess-1', {
        tier: 'pesada',
        triggeredBy: 'auto',
        eventCount: 25,
        hypotheses: [buildDraft()],
      }),
    ).rejects.toThrow(/análise current/i);
  });
});
