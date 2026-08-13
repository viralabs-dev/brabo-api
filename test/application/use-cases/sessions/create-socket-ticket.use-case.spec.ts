import { describe, it, expect, vi } from 'vitest';
import { CreateSocketTicketUseCase } from '../../../../src/application/use-cases/sessions/create-socket-ticket.use-case';
import type { SessionRepository } from '../../../../src/application/ports/session-repository.port';
import type {
  NovoSocketTicket,
  SessionSocketTicketRepository,
} from '../../../../src/application/ports/session-socket-ticket-repository.port';
import type { Session } from '../../../../src/domain/sessions/session.entity';

const now = new Date();

function buildSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    projectId: 'proj-1',
    createdBy: 'user-1',
    status: 'active',
    nextSeq: 1,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    terminationReason: null,
    ...overrides,
  } as Session;
}

function buildHarness(opts: { session?: Session | null }) {
  const session = opts.session === undefined ? buildSession() : opts.session;

  const sessions = {
    findInProject: () => Promise.resolve(session),
  } as unknown as SessionRepository;

  const emitir = vi.fn((_novo: NovoSocketTicket) => Promise.resolve());
  const tickets = { emitir } as unknown as SessionSocketTicketRepository;

  return { useCase: new CreateSocketTicketUseCase(sessions, tickets), emitir };
}

describe('CreateSocketTicketUseCase', () => {
  it('caminho feliz: viewer pedindo heartbeat recebe um ticket de 30s', async () => {
    const { useCase, emitir } = buildHarness({});

    const antes = Date.now();
    const emitido = await useCase.execute(
      'proj-1',
      'sess-1',
      'user-1',
      'viewer',
      'heartbeat',
    );

    expect(emitido.ticket).toBeTruthy();
    expect(typeof emitido.ticket).toBe('string');
    expect(emitido.expiresAt.getTime()).toBeGreaterThan(antes);
    expect(emitido.expiresAt.getTime()).toBeLessThanOrEqual(antes + 30_000 + 50);

    expect(emitir).toHaveBeenCalledTimes(1);
    const [novo] = emitir.mock.calls[0] as [NovoSocketTicket];
    expect(novo.sessionId).toBe('sess-1');
    expect(novo.projectId).toBe('proj-1');
    expect(novo.userId).toBe('user-1');
    expect(novo.scope).toBe('heartbeat');
    // Nunca o token bruto no hash, e o hash não pode ser vazio.
    expect(novo.ticketHash).toBeTruthy();
    expect(novo.ticketHash).not.toBe(emitido.ticket);
  });

  it('dois tickets seguidos têm valores diferentes — CSPRNG, não determinístico', async () => {
    const { useCase } = buildHarness({});

    const a = await useCase.execute('proj-1', 'sess-1', 'user-1', 'viewer', 'heartbeat');
    const b = await useCase.execute('proj-1', 'sess-1', 'user-1', 'viewer', 'heartbeat');

    expect(a.ticket).not.toBe(b.ticket);
  });

  it('viewer pedindo escopo terminal: 403, papel insuficiente', async () => {
    const { useCase, emitir } = buildHarness({});

    await expect(
      useCase.execute('proj-1', 'sess-1', 'user-1', 'viewer', 'terminal'),
    ).rejects.toThrow(/papel insuficiente/i);

    expect(emitir).not.toHaveBeenCalled();
  });

  it('developer pedindo escopo terminal: autorizado', async () => {
    const { useCase } = buildHarness({});

    const emitido = await useCase.execute(
      'proj-1',
      'sess-1',
      'user-1',
      'developer',
      'terminal',
    );

    expect(emitido.ticket).toBeTruthy();
  });

  it('sessão fora do projeto (ou inexistente): 404', async () => {
    const { useCase } = buildHarness({ session: null });

    await expect(
      useCase.execute('proj-1', 'sess-1', 'user-1', 'owner', 'heartbeat'),
    ).rejects.toThrow(/Sessão não encontrada/i);
  });
});
