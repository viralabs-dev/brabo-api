import { describe, it, expect, vi } from 'vitest';
import { AcceptHypothesisUseCase } from '../../../../src/application/use-cases/execution/accept-hypothesis.use-case';
import { DismissHypothesisUseCase } from '../../../../src/application/use-cases/execution/dismiss-hypothesis.use-case';
import type { UnitOfWork } from '../../../../src/application/ports/unit-of-work.port';
import type { PsychologistHypothesisRepository } from '../../../../src/application/ports/psychologist-hypothesis-repository.port';
import type { AnamneseQueueRepository } from '../../../../src/application/ports/anamnese-repository.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { PsychologistHypothesis } from '../../../../src/domain/psychologist/psychologist-hypothesis.entity';

const now = new Date();

function buildHypothesis(
  overrides: Partial<PsychologistHypothesis> = {},
): PsychologistHypothesis {
  return {
    id: 'hyp-1',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    analysisId: 'analysis-1',
    agenteAlvo: 'dev-api',
    observacao: 'observação',
    hipotese: 'hipótese',
    sugestao: 'sugestão',
    confiancaPercent: 70,
    evidenceEventIds: ['evt-1'],
    terminationAnalysis: null,
    status: 'proposed',
    decidedBy: null,
    decidedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildHarness(opts: {
  hypothesis?: PsychologistHypothesis | null;
  // false simula a corrida: o CAS não casa porque outra ação já decidiu.
  casWins?: boolean;
} = {}) {
  const hypothesis =
    opts.hypothesis === undefined ? buildHypothesis() : opts.hypothesis;
  const casWins = opts.casWins ?? true;

  const unitOfWork = {
    runInTransaction: (work: () => Promise<unknown>) => work(),
  } as unknown as UnitOfWork;

  const updateStatusIfProposed = vi.fn(
    (id: string, status: 'accepted' | 'dismissed', decidedBy: string) =>
      Promise.resolve(
        casWins
          ? buildHypothesis({ id, status, decidedBy, decidedAt: now })
          : null,
      ),
  );

  const hypotheses = {
    findById: () => Promise.resolve(hypothesis),
    updateStatusIfProposed,
  } as unknown as PsychologistHypothesisRepository;

  const appendEvent = vi.fn(() => Promise.resolve({}));
  const appendSessionEvent = {
    execute: appendEvent,
  } as unknown as AppendSessionEventUseCase;

  const enqueueHypothesis = vi.fn(() => Promise.resolve());
  const anamneseQueue = {
    enqueueHypothesis,
  } as unknown as AnamneseQueueRepository;

  return {
    accept: new AcceptHypothesisUseCase(
      unitOfWork,
      hypotheses,
      appendSessionEvent,
      anamneseQueue,
    ),
    dismiss: new DismissHypothesisUseCase(
      unitOfWork,
      hypotheses,
      appendSessionEvent,
    ),
    updateStatusIfProposed,
    appendEvent,
    enqueueHypothesis,
  };
}

describe('AcceptHypothesisUseCase', () => {
  it('caminho feliz: aceita, emite os dois eventos e enfileira pra Anamnese', async () => {
    const { accept, appendEvent, enqueueHypothesis } = buildHarness();

    const updated = await accept.execute('proj-1', 'hyp-1', 'user-9');

    expect(updated.status).toBe('accepted');
    expect(updated.decidedBy).toBe('user-9');

    // O evento pra Anamnese é um TIPO distinto, não uma flag no payload —
    // filtrável sem inspecionar payload.
    expect(appendEvent).toHaveBeenCalledWith(
      'proj-1',
      'sess-1',
      expect.objectContaining({ type: 'psychologist.hypothesis_accepted' }),
    );
    expect(appendEvent).toHaveBeenCalledWith(
      'proj-1',
      'sess-1',
      expect.objectContaining({
        type: 'psychologist.hypothesis_accepted_for_anamnese',
      }),
    );

    // Loop fechado: a hipótese aceita entra na fila da Anamnese.
    expect(enqueueHypothesis).toHaveBeenCalledWith('proj-1', 'hyp-1');
  });

  it('hipótese de outro projeto: 404, nada muda', async () => {
    const { accept, updateStatusIfProposed, enqueueHypothesis } = buildHarness({
      hypothesis: buildHypothesis({ projectId: 'proj-outro' }),
    });

    await expect(accept.execute('proj-1', 'hyp-1', 'user-9')).rejects.toThrow(
      /não encontrada/i,
    );
    expect(updateStatusIfProposed).not.toHaveBeenCalled();
    expect(enqueueHypothesis).not.toHaveBeenCalled();
  });

  it('hipótese já decidida: rejeita pelo domínio antes de tocar o banco', async () => {
    const { accept, updateStatusIfProposed } = buildHarness({
      hypothesis: buildHypothesis({ status: 'accepted' }),
    });

    await expect(accept.execute('proj-1', 'hyp-1', 'user-9')).rejects.toThrow();
    expect(updateStatusIfProposed).not.toHaveBeenCalled();
  });

  it('corrida de double-accept: o CAS não casa e nada é emitido nem enfileirado', async () => {
    // Cenário real de dois cliques: as duas chamadas passam pela checagem de
    // domínio (leram `proposed`), mas só uma consegue o UPDATE.
    const { accept, appendEvent, enqueueHypothesis } = buildHarness({
      casWins: false,
    });

    await expect(accept.execute('proj-1', 'hyp-1', 'user-9')).rejects.toThrow(
      /já foi decidida/i,
    );
    expect(appendEvent).not.toHaveBeenCalled();
    expect(enqueueHypothesis).not.toHaveBeenCalled();
  });
});

describe('DismissHypothesisUseCase', () => {
  it('caminho feliz: descarta, emite o evento e NÃO enfileira pra Anamnese', async () => {
    const { dismiss, appendEvent, enqueueHypothesis } = buildHarness();

    const updated = await dismiss.execute('proj-1', 'hyp-1', 'user-9');

    expect(updated.status).toBe('dismissed');
    expect(appendEvent).toHaveBeenCalledTimes(1);
    expect(appendEvent).toHaveBeenCalledWith(
      'proj-1',
      'sess-1',
      expect.objectContaining({ type: 'psychologist.hypothesis_dismissed' }),
    );
    expect(enqueueHypothesis).not.toHaveBeenCalled();
  });

  it('corrida de double-dismiss: o CAS não casa e nenhum evento é emitido', async () => {
    const { dismiss, appendEvent } = buildHarness({ casWins: false });

    await expect(dismiss.execute('proj-1', 'hyp-1', 'user-9')).rejects.toThrow(
      /já foi decidida/i,
    );
    expect(appendEvent).not.toHaveBeenCalled();
  });
});
