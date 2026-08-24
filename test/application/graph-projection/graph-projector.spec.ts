import { describe, expect, it, vi } from 'vitest';
import { GraphProjector } from '../../../src/application/graph-projection/graph-projector';
import { RecordHandoffUseCase } from '../../../src/application/use-cases/graph/record-handoff.use-case';
import { RecordHypothesisUseCase } from '../../../src/application/use-cases/graph/record-hypothesis.use-case';
import { RecordAnamneseProfileUseCase } from '../../../src/application/use-cases/graph/record-anamnese-profile.use-case';
import { RecordInteractionUseCase } from '../../../src/application/use-cases/graph/record-interaction.use-case';
import { GraphUnavailableError } from '../../../src/domain/graph/graph-errors';
import { GRAPH_PROJECTION_AGGREGATE_TYPE } from '../../../src/domain/graph/graph-projection-events';
import type {
  GraphStore,
  GraphTx,
} from '../../../src/infrastructure/graph/graph-store';
import type { OutboxEvent } from '../../../src/domain/shared/outbox-event.entity';
import type { SessionEvent } from '../../../src/domain/sessions/session-event.entity';
import type { Session } from '../../../src/domain/sessions/session.entity';
import { OutboxRepository } from '../../../src/application/ports/outbox-repository.port';
import { SessionEventRepository } from '../../../src/application/ports/session-event-repository.port';
import { SessionRepository } from '../../../src/application/ports/session-repository.port';

/** Mesmo fake usado nos specs dos casos de uso de grafo — `run` mockado, sem driver de verdade. */
function fakeGraphStore(run: GraphTx['run']): GraphStore {
  return {
    executeWrite: (work: (tx: GraphTx) => unknown) => Promise.resolve(work({ run })),
    executeRead: (work: (tx: GraphTx) => unknown) => Promise.resolve(work({ run })),
  } as unknown as GraphStore;
}

function unavailableGraphStore(): GraphStore {
  return {
    executeWrite: () =>
      Promise.reject(new GraphUnavailableError('Neo4j fora do ar.')),
    executeRead: () =>
      Promise.reject(new GraphUnavailableError('Neo4j fora do ar.')),
  } as unknown as GraphStore;
}

/** Outbox em memória — só o que o GraphProjector consome (listUnprocessed/markProcessed/append). */
class FakeOutbox implements OutboxRepository {
  rows: OutboxEvent[] = [];
  private seq = 0;

  async append(input: {
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload: unknown;
  }): Promise<void> {
    this.seq += 1;
    this.rows.push({
      id: `outbox-${this.seq}`,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      payload: input.payload,
      createdAt: new Date(),
      processedAt: null,
    });
  }

  async listUnprocessed(
    aggregateType: string,
    limit: number,
  ): Promise<OutboxEvent[]> {
    return this.rows
      .filter((r) => r.aggregateType === aggregateType && r.processedAt === null)
      .slice(0, limit);
  }

  async markProcessed(id: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.processedAt = new Date();
  }
}

class FakeSessionEvents implements SessionEventRepository {
  events = new Map<string, SessionEvent>();

  async append(): Promise<SessionEvent> {
    throw new Error('não usado neste teste');
  }
  async listPaginated(): Promise<never> {
    throw new Error('não usado neste teste');
  }
  async findById(id: string): Promise<SessionEvent | null> {
    return this.events.get(id) ?? null;
  }
  async listByTypeForProject(): Promise<SessionEvent[]> {
    throw new Error('não usado neste teste');
  }
  async listByTypeInSession(): Promise<SessionEvent[]> {
    throw new Error('não usado neste teste');
  }
  async listForProjectInWindow(): Promise<SessionEvent[]> {
    throw new Error('não usado neste teste');
  }
}

class FakeSessions implements SessionRepository {
  sessions = new Map<string, Session>();

  async create(): Promise<Session> {
    throw new Error('não usado neste teste');
  }
  async findInProject(projectId: string, sessionId: string) {
    const session = this.sessions.get(sessionId);
    return session && session.projectId === projectId ? session : null;
  }
  async listForProject(): Promise<Session[]> {
    throw new Error('não usado neste teste');
  }
  async findActiveExecutionSession(): Promise<Session | null> {
    throw new Error('não usado neste teste');
  }
  async rename(): Promise<Session | null> {
    throw new Error('não usado neste teste');
  }
  async findInProjectForUpdate(): Promise<Session | null> {
    throw new Error('não usado neste teste');
  }
  async updateStatus(): Promise<Session> {
    throw new Error('não usado neste teste');
  }
  async incrementSeq(): Promise<number | null> {
    throw new Error('não usado neste teste');
  }
}

function buildProjector(opts: {
  graphRun: GraphTx['run'];
  outbox: FakeOutbox;
  sessionEvents: FakeSessionEvents;
  sessions: FakeSessions;
}) {
  const graph = fakeGraphStore(opts.graphRun);
  return new GraphProjector(
    opts.outbox,
    opts.sessionEvents,
    opts.sessions,
    new RecordHandoffUseCase(graph),
    new RecordHypothesisUseCase(graph),
    new RecordAnamneseProfileUseCase(graph),
    new RecordInteractionUseCase(graph),
  );
}

function makeEvent(overrides: Partial<SessionEvent>): SessionEvent {
  return {
    id: 'evt-1',
    sessionId: 'sess-1',
    seq: 1,
    type: 'handoff.offered',
    actor: { kind: 'agent', id: 'po' },
    payload: {},
    createdAt: new Date(),
    ...overrides,
  };
}

describe('GraphProjector', () => {
  it('projeta handoff.offered: chama RecordHandoffUseCase e marca a linha processada', async () => {
    const outbox = new FakeOutbox();
    const sessionEvents = new FakeSessionEvents();
    const sessions = new FakeSessions();
    sessionEvents.events.set(
      'evt-handoff',
      makeEvent({
        id: 'evt-handoff',
        sessionId: 'sess-1',
        seq: 7,
        type: 'handoff.offered',
        actor: { kind: 'agent', id: 'po' },
        payload: { toAgent: 'arquiteto' },
      }),
    );
    await outbox.append({
      aggregateType: GRAPH_PROJECTION_AGGREGATE_TYPE,
      aggregateId: 'sess-1',
      eventType: 'handoff.offered',
      payload: { eventId: 'evt-handoff' },
    });

    const run = vi.fn<GraphTx['run']>().mockResolvedValue({ records: [] });
    const projector = buildProjector({ graphRun: run, outbox, sessionEvents, sessions });

    await projector.drainOnce();

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][1]).toEqual({
      sessionId: 'sess-1',
      seq: 7,
      fromAgent: 'po',
      toAgent: 'arquiteto',
    });
    expect(outbox.rows[0].processedAt).not.toBeNull();
  });

  it('projeta psychologist.hypothesis_proposed resolvendo evidenceEventIds para seq', async () => {
    const outbox = new FakeOutbox();
    const sessionEvents = new FakeSessionEvents();
    const sessions = new FakeSessions();
    sessionEvents.events.set(
      'evt-ev1',
      makeEvent({ id: 'evt-ev1', sessionId: 'sess-1', seq: 3, type: 'agent.response' }),
    );
    sessionEvents.events.set(
      'evt-ev2',
      makeEvent({ id: 'evt-ev2', sessionId: 'sess-1', seq: 5, type: 'agent.response' }),
    );
    sessionEvents.events.set(
      'evt-hyp',
      makeEvent({
        id: 'evt-hyp',
        sessionId: 'sess-1',
        seq: 9,
        type: 'psychologist.hypothesis_proposed',
        actor: { kind: 'agent', id: 'psicologo' },
        payload: {
          hypothesisId: 'hyp-1',
          hipotese: 'o dev travou esperando aprovação',
          evidenceEventIds: ['evt-ev1', 'evt-ev2'],
        },
      }),
    );
    await outbox.append({
      aggregateType: GRAPH_PROJECTION_AGGREGATE_TYPE,
      aggregateId: 'sess-1',
      eventType: 'psychologist.hypothesis_proposed',
      payload: { eventId: 'evt-hyp' },
    });

    const run = vi.fn<GraphTx['run']>().mockResolvedValue({ records: [] });
    const projector = buildProjector({ graphRun: run, outbox, sessionEvents, sessions });

    await projector.drainOnce();

    expect(run.mock.calls[0][1]).toEqual({
      hypothesisId: 'hyp-1',
      sessionId: 'sess-1',
      descricao: 'o dev travou esperando aprovação',
      status: 'ativa',
      evidenceSeqs: [3, 5],
    });
    expect(outbox.rows[0].processedAt).not.toBeNull();
  });

  it('projeta anamnese.profile_updated', async () => {
    const outbox = new FakeOutbox();
    const sessionEvents = new FakeSessionEvents();
    const sessions = new FakeSessions();
    sessionEvents.events.set(
      'evt-prof',
      makeEvent({
        id: 'evt-prof',
        sessionId: 'sess-1',
        seq: 4,
        type: 'anamnese.profile_updated',
        actor: { kind: 'agent', id: 'anamnese' },
        payload: { userId: 'user-1', competency: 'typescript', level: 'intermediario' },
      }),
    );
    await outbox.append({
      aggregateType: GRAPH_PROJECTION_AGGREGATE_TYPE,
      aggregateId: 'sess-1',
      eventType: 'anamnese.profile_updated',
      payload: { eventId: 'evt-prof' },
    });

    const run = vi.fn<GraphTx['run']>().mockResolvedValue({ records: [] });
    const projector = buildProjector({ graphRun: run, outbox, sessionEvents, sessions });

    await projector.drainOnce();

    expect(run.mock.calls[0][1]).toEqual({
      userId: 'user-1',
      dimensao: 'typescript',
      proficiencia: 'intermediario',
    });
    expect(outbox.rows[0].processedAt).not.toBeNull();
  });

  it('projeta session.closed consolidando a Interacao com a janela inteira de seq', async () => {
    const outbox = new FakeOutbox();
    const sessionEvents = new FakeSessionEvents();
    const sessions = new FakeSessions();
    sessions.sessions.set('sess-1', {
      id: 'sess-1',
      projectId: 'proj-1',
      createdBy: 'user-1',
      status: 'closed',
      kind: 'consultiva',
      name: null,
      nextSeq: 11,
      createdAt: new Date(),
      updatedAt: new Date(),
      closedAt: new Date(),
      terminationReason: null,
      traceParent: null,
    });
    await outbox.append({
      aggregateType: GRAPH_PROJECTION_AGGREGATE_TYPE,
      aggregateId: 'sess-1',
      eventType: 'session.closed',
      payload: { sessionId: 'sess-1', projectId: 'proj-1' },
    });

    const run = vi.fn<GraphTx['run']>().mockResolvedValue({ records: [] });
    const projector = buildProjector({ graphRun: run, outbox, sessionEvents, sessions });

    await projector.drainOnce();

    expect(run.mock.calls[0][1]).toEqual({
      userId: 'user-1',
      projectId: 'proj-1',
      sessionId: 'sess-1',
      seqInicio: 1,
      seqFim: 10,
    });
    expect(outbox.rows[0].processedAt).not.toBeNull();
  });

  it('degradação: GraphStore indisponível deixa a linha SEM marcar processada, para retry', async () => {
    const outbox = new FakeOutbox();
    const sessionEvents = new FakeSessionEvents();
    const sessions = new FakeSessions();
    sessionEvents.events.set(
      'evt-handoff',
      makeEvent({
        id: 'evt-handoff',
        sessionId: 'sess-1',
        seq: 1,
        type: 'handoff.offered',
        payload: { toAgent: 'arquiteto' },
      }),
    );
    await outbox.append({
      aggregateType: GRAPH_PROJECTION_AGGREGATE_TYPE,
      aggregateId: 'sess-1',
      eventType: 'handoff.offered',
      payload: { eventId: 'evt-handoff' },
    });

    const graph = unavailableGraphStore();
    const projector = new GraphProjector(
      outbox,
      sessionEvents,
      sessions,
      new RecordHandoffUseCase(graph),
      new RecordHypothesisUseCase(graph),
      new RecordAnamneseProfileUseCase(graph),
      new RecordInteractionUseCase(graph),
    );

    await projector.drainOnce();

    expect(outbox.rows[0].processedAt).toBeNull();
  });

  it('degradação: um item indisponível não impede o retry — o próximo drainOnce processa quando o grafo volta', async () => {
    const outbox = new FakeOutbox();
    const sessionEvents = new FakeSessionEvents();
    const sessions = new FakeSessions();
    sessionEvents.events.set(
      'evt-handoff',
      makeEvent({
        id: 'evt-handoff',
        sessionId: 'sess-1',
        seq: 1,
        type: 'handoff.offered',
        payload: { toAgent: 'arquiteto' },
      }),
    );
    await outbox.append({
      aggregateType: GRAPH_PROJECTION_AGGREGATE_TYPE,
      aggregateId: 'sess-1',
      eventType: 'handoff.offered',
      payload: { eventId: 'evt-handoff' },
    });

    // Primeiro ciclo: grafo fora do ar.
    const down = new GraphProjector(
      outbox,
      sessionEvents,
      sessions,
      new RecordHandoffUseCase(unavailableGraphStore()),
      new RecordHypothesisUseCase(unavailableGraphStore()),
      new RecordAnamneseProfileUseCase(unavailableGraphStore()),
      new RecordInteractionUseCase(unavailableGraphStore()),
    );
    await down.drainOnce();
    expect(outbox.rows[0].processedAt).toBeNull();

    // Segundo ciclo: grafo voltou — o MESMO item, ainda não processado, é
    // retentado com sucesso.
    const run = vi.fn<GraphTx['run']>().mockResolvedValue({ records: [] });
    const up = buildProjector({ graphRun: run, outbox, sessionEvents, sessions });
    await up.drainOnce();

    expect(run).toHaveBeenCalledTimes(1);
    expect(outbox.rows[0].processedAt).not.toBeNull();
  });

  it('idempotência: reprocessar o MESMO evento (outbox reaberta) manda os MESMOS parâmetros ao grafo — sem segunda idempotência divergente no projetor', async () => {
    const outbox = new FakeOutbox();
    const sessionEvents = new FakeSessionEvents();
    const sessions = new FakeSessions();
    sessionEvents.events.set(
      'evt-handoff',
      makeEvent({
        id: 'evt-handoff',
        sessionId: 'sess-1',
        seq: 2,
        type: 'handoff.offered',
        actor: { kind: 'agent', id: 'criativo' },
        payload: { toAgent: 'po' },
      }),
    );
    await outbox.append({
      aggregateType: GRAPH_PROJECTION_AGGREGATE_TYPE,
      aggregateId: 'sess-1',
      eventType: 'handoff.offered',
      payload: { eventId: 'evt-handoff' },
    });

    const run = vi.fn<GraphTx['run']>().mockResolvedValue({ records: [] });
    const projector = buildProjector({ graphRun: run, outbox, sessionEvents, sessions });

    await projector.drainOnce();
    // Simula um replay do outbox (ex.: reconstrução do grafo do zero) — a
    // MESMA linha reaberta, como quem reprocessa manualmente.
    outbox.rows[0].processedAt = null;
    await projector.drainOnce();

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0][1]).toEqual(run.mock.calls[1][1]);
  });

  it('tipo de evento sem handler de projeção não lança — loga, marca processado (nunca deveria acontecer, tipo é filtrado na escrita) e não chama o grafo', async () => {
    const outbox = new FakeOutbox();
    const sessionEvents = new FakeSessionEvents();
    const sessions = new FakeSessions();
    await outbox.append({
      aggregateType: GRAPH_PROJECTION_AGGREGATE_TYPE,
      aggregateId: 'sess-1',
      eventType: 'tipo.desconhecido',
      payload: {},
    });

    const run = vi.fn<GraphTx['run']>().mockResolvedValue({ records: [] });
    const projector = buildProjector({ graphRun: run, outbox, sessionEvents, sessions });

    await expect(projector.drainOnce()).resolves.toBeUndefined();
    expect(run).not.toHaveBeenCalled();
    expect(outbox.rows[0].processedAt).not.toBeNull();
  });

  it('evento fonte sumiu do event log: não lança, marca processado (nada mais a fazer) e não chama o grafo', async () => {
    const outbox = new FakeOutbox();
    const sessionEvents = new FakeSessionEvents();
    const sessions = new FakeSessions();
    // Nenhum evento cadastrado em `sessionEvents` para este id.
    await outbox.append({
      aggregateType: GRAPH_PROJECTION_AGGREGATE_TYPE,
      aggregateId: 'sess-1',
      eventType: 'handoff.offered',
      payload: { eventId: 'evt-sumiu' },
    });

    const run = vi.fn<GraphTx['run']>().mockResolvedValue({ records: [] });
    const projector = buildProjector({ graphRun: run, outbox, sessionEvents, sessions });

    await projector.drainOnce();

    expect(run).not.toHaveBeenCalled();
    expect(outbox.rows[0].processedAt).not.toBeNull();
  });
});
