import { describe, it, expect } from 'vitest';
import { GetSessionEventUseCase } from '../../../../src/application/use-cases/sessions/get-session-event.use-case';
import type { SessionRepository } from '../../../../src/application/ports/session-repository.port';
import type { SessionEventRepository } from '../../../../src/application/ports/session-event-repository.port';
import type { Session } from '../../../../src/domain/sessions/session.entity';
import type { SessionEvent } from '../../../../src/domain/sessions/session-event.entity';

const now = new Date();

function buildEvent(overrides: Partial<SessionEvent> = {}): SessionEvent {
  return {
    id: 'evt-1',
    sessionId: 'sess-1',
    seq: 7,
    // Tipo de "ruído de máquina": o feed da UI esconde estes, e é exatamente
    // o que o Psicólogo mais cita como evidência — o motivo desta rota
    // existir.
    type: 'agent.response',
    actor: { kind: 'agent', id: 'dev-api' },
    payload: { content: 'turno do modelo' },
    createdAt: now,
    ...overrides,
  };
}

function buildHarness(opts: {
  session?: Session | null;
  event?: SessionEvent | null;
}) {
  const session =
    opts.session === undefined
      ? ({
          id: 'sess-1',
          projectId: 'proj-1',
          createdBy: 'user-1',
          status: 'closed',
          nextSeq: 10,
          createdAt: now,
          updatedAt: now,
          closedAt: now,
          terminationReason: null,
        } as Session)
      : opts.session;

  const sessions = {
    findInProject: () => Promise.resolve(session),
  } as unknown as SessionRepository;

  const sessionEvents = {
    findById: () => Promise.resolve(opts.event ?? null),
  } as unknown as SessionEventRepository;

  return new GetSessionEventUseCase(sessions, sessionEvents);
}

describe('GetSessionEventUseCase', () => {
  it('devolve o evento citado mesmo sendo tipo escondido pelo feed', async () => {
    const useCase = buildHarness({ event: buildEvent() });

    const event = await useCase.execute('proj-1', 'sess-1', 'evt-1');

    expect(event.id).toBe('evt-1');
    expect(event.type).toBe('agent.response');
  });

  it('evento de OUTRA sessão: 404, não vaza', async () => {
    const useCase = buildHarness({
      event: buildEvent({ sessionId: 'sess-outra' }),
    });

    await expect(useCase.execute('proj-1', 'sess-1', 'evt-1')).rejects.toThrow(
      /Evento não encontrado/i,
    );
  });

  it('evento inexistente: 404', async () => {
    const useCase = buildHarness({ event: null });

    await expect(useCase.execute('proj-1', 'sess-1', 'evt-x')).rejects.toThrow(
      /Evento não encontrado/i,
    );
  });

  it('sessão fora do projeto: 404 antes de buscar o evento', async () => {
    const useCase = buildHarness({ session: null, event: buildEvent() });

    await expect(
      useCase.execute('proj-outro', 'sess-1', 'evt-1'),
    ).rejects.toThrow(/Sessão não encontrada/i);
  });
});
