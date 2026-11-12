import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoriaDoProjetoTranslator } from '../../../src/application/graph-projection/memoria-do-projeto-translator';
import { GraphProjector } from '../../../src/application/graph-projection/graph-projector';
import { RecordHandoffUseCase } from '../../../src/application/use-cases/graph/record-handoff.use-case';
import { RecordHypothesisUseCase } from '../../../src/application/use-cases/graph/record-hypothesis.use-case';
import { RecordAnamneseProfileUseCase } from '../../../src/application/use-cases/graph/record-anamnese-profile.use-case';
import { RecordInteractionUseCase } from '../../../src/application/use-cases/graph/record-interaction.use-case';
import { RecordProfileFactUseCase } from '../../../src/application/use-cases/graph/record-profile-fact.use-case';
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
    executeWrite: (work: (tx: GraphTx) => unknown) =>
      Promise.resolve(work({ run })),
    executeRead: (work: (tx: GraphTx) => unknown) =>
      Promise.resolve(work({ run })),
  } as unknown as GraphStore;
}

function unavailableGraphStore(causa?: unknown): GraphStore {
  return {
    executeWrite: () =>
      Promise.reject(new GraphUnavailableError('Neo4j fora do ar.', causa)),
    executeRead: () =>
      Promise.reject(new GraphUnavailableError('Neo4j fora do ar.', causa)),
  } as unknown as GraphStore;
}

/** Outbox em memória — só o que o GraphProjector consome (listUnprocessed/markProcessed/append). */
class FakeOutbox implements OutboxRepository {
  rows: OutboxEvent[] = [];
  private seq = 0;

  append(input: {
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
    return Promise.resolve();
  }

  listByEventTypeAfter(
    eventType: string,
    after: Date,
    limit: number,
  ): Promise<OutboxEvent[]> {
    return Promise.resolve(
      this.rows
        .filter((r) => r.eventType === eventType && r.createdAt > after)
        .slice(0, limit),
    );
  }

  listUnprocessed(
    aggregateType: string,
    limit: number,
  ): Promise<OutboxEvent[]> {
    return Promise.resolve(
      this.rows
        .filter(
          (r) => r.aggregateType === aggregateType && r.processedAt === null,
        )
        .slice(0, limit),
    );
  }

  markProcessed(id: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.processedAt = new Date();
    return Promise.resolve();
  }

  markAllProcessed(aggregateType: string): Promise<number> {
    let total = 0;
    for (const r of this.rows) {
      if (r.aggregateType === aggregateType && r.processedAt === null) {
        r.processedAt = new Date();
        total += 1;
      }
    }
    return Promise.resolve(total);
  }
}

class FakeSessionEvents implements SessionEventRepository {
  events = new Map<string, SessionEvent>();

  append(): Promise<SessionEvent> {
    return Promise.reject(new Error('não usado neste teste'));
  }
  listPaginated(): Promise<never> {
    return Promise.reject(new Error('não usado neste teste'));
  }
  findById(id: string): Promise<SessionEvent | null> {
    return Promise.resolve(this.events.get(id) ?? null);
  }
  listByType(): Promise<SessionEvent[]> {
    return Promise.resolve([]);
  }
  listByTypeForProject(): Promise<SessionEvent[]> {
    return Promise.reject(new Error('não usado neste teste'));
  }
  listByTypeInSession(): Promise<SessionEvent[]> {
    return Promise.reject(new Error('não usado neste teste'));
  }
  findLatestOfTypesInSession(): Promise<SessionEvent | null> {
    return Promise.reject(new Error('não usado neste teste'));
  }
  listForProjectInWindow(): Promise<SessionEvent[]> {
    return Promise.reject(new Error('não usado neste teste'));
  }
}

class FakeSessions implements SessionRepository {
  sessions = new Map<string, Session>();

  create(): Promise<Session> {
    return Promise.reject(new Error('não usado neste teste'));
  }
  findInProject(projectId: string, sessionId: string) {
    const session = this.sessions.get(sessionId);
    return Promise.resolve(
      session && session.projectId === projectId ? session : null,
    );
  }
  listForProject(): Promise<Session[]> {
    return Promise.reject(new Error('não usado neste teste'));
  }
  findActiveExecutionSession(): Promise<Session | null> {
    return Promise.reject(new Error('não usado neste teste'));
  }
  rename(): Promise<Session | null> {
    return Promise.reject(new Error('não usado neste teste'));
  }
  findInProjectForUpdate(): Promise<Session | null> {
    return Promise.reject(new Error('não usado neste teste'));
  }
  updateStatus(): Promise<Session> {
    return Promise.reject(new Error('não usado neste teste'));
  }
  incrementSeq(): Promise<{
    seq: number;
    status: Session['status'];
  } | null> {
    return Promise.reject(new Error('não usado neste teste'));
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
    new RecordProfileFactUseCase(graph),
    {} as MemoriaDoProjetoTranslator,
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
  // Os casos abaixo presumem grafo CONFIGURADO (RN-1148). Os de "não configurado"
  // desligam a config no próprio teste.
  const envOriginal = { ...process.env };
  beforeEach(() => {
    process.env.NEO4J_URI = 'bolt://grafo-de-teste:7687';
    process.env.NEO4J_USER = 'neo4j';
    process.env.NEO4J_PASSWORD = 'senha-de-teste';
  });
  afterEach(() => {
    process.env = { ...envOriginal };
    vi.restoreAllMocks();
  });

  it('RN-1148: grafo não configurado descarta as pendentes de uma vez, loga uma vez e não toca o grafo', async () => {
    delete process.env.NEO4J_URI;
    delete process.env.NEO4J_USER;
    delete process.env.NEO4J_PASSWORD;
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation();
    const outbox = new FakeOutbox();
    for (let i = 0; i < 3; i += 1) {
      await outbox.append({
        aggregateType: GRAPH_PROJECTION_AGGREGATE_TYPE,
        aggregateId: 'sess-1',
        eventType: 'handoff.offered',
        payload: { eventId: `evt-${i}` },
      });
    }
    const sessionEvents = new FakeSessionEvents();
    const sessions = new FakeSessions();
    const run = vi.fn<GraphTx['run']>().mockResolvedValue({ records: [] });
    const projector = buildProjector({
      graphRun: run,
      outbox,
      sessionEvents,
      sessions,
    });

    await projector.drainOnce();
    await projector.drainOnce();

    expect(outbox.rows.every((r) => r.processedAt !== null)).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/3 linhas.*descartadas/);
  });

  it('RN-1149: grafo configurado e fora do ar avisa uma vez, não a cada ciclo', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation();
    const outbox = new FakeOutbox();
    const sessionEvents = new FakeSessionEvents();
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
      new FakeSessions(),
      new RecordHandoffUseCase(graph),
      new RecordHypothesisUseCase(graph),
      new RecordAnamneseProfileUseCase(graph),
      new RecordInteractionUseCase(graph),
      new RecordProfileFactUseCase(graph),
      {} as MemoriaDoProjetoTranslator,
    );

    await projector.drainOnce();
    await projector.drainOnce();
    await projector.drainOnce();

    expect(outbox.rows[0].processedAt).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

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
    const projector = buildProjector({
      graphRun: run,
      outbox,
      sessionEvents,
      sessions,
    });

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
      makeEvent({
        id: 'evt-ev1',
        sessionId: 'sess-1',
        seq: 3,
        type: 'agent.response',
      }),
    );
    sessionEvents.events.set(
      'evt-ev2',
      makeEvent({
        id: 'evt-ev2',
        sessionId: 'sess-1',
        seq: 5,
        type: 'agent.response',
      }),
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
    const projector = buildProjector({
      graphRun: run,
      outbox,
      sessionEvents,
      sessions,
    });

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
        payload: {
          userId: 'user-1',
          competency: 'typescript',
          level: 'intermediario',
        },
      }),
    );
    await outbox.append({
      aggregateType: GRAPH_PROJECTION_AGGREGATE_TYPE,
      aggregateId: 'sess-1',
      eventType: 'anamnese.profile_updated',
      payload: { eventId: 'evt-prof' },
    });

    const run = vi.fn<GraphTx['run']>().mockResolvedValue({ records: [] });
    const projector = buildProjector({
      graphRun: run,
      outbox,
      sessionEvents,
      sessions,
    });

    await projector.drainOnce();

    expect(run.mock.calls[0][1]).toEqual({
      userId: 'user-1',
      dimensao: 'typescript',
      proficiencia: 'intermediario',
    });
    expect(outbox.rows[0].processedAt).not.toBeNull();
  });

  async function projetarAceite(payload: Record<string, unknown>) {
    const outbox = new FakeOutbox();
    const sessionEvents = new FakeSessionEvents();
    const sessions = new FakeSessions();
    sessionEvents.events.set(
      'evt-aceite',
      makeEvent({
        id: 'evt-aceite',
        sessionId: 'sess-1',
        seq: 12,
        type: 'psychologist.hypothesis_accepted',
        actor: { kind: 'user', id: 'user-1' },
        payload,
        createdAt: new Date('2026-10-01T10:00:00.000Z'),
      }),
    );
    await outbox.append({
      aggregateType: GRAPH_PROJECTION_AGGREGATE_TYPE,
      aggregateId: 'sess-1',
      eventType: 'psychologist.hypothesis_accepted',
      payload: { eventId: 'evt-aceite' },
    });
    const run = vi.fn<GraphTx['run']>().mockResolvedValue({ records: [] });
    const projector = buildProjector({
      graphRun: run,
      outbox,
      sessionEvents,
      sessions,
    });
    await projector.drainOnce();
    return { run, outbox };
  }

  it('RN-680: projeta o aceite da PRÓPRIA pessoa como fato do perfil', async () => {
    const { run, outbox } = await projetarAceite({
      hypothesisId: 'hyp-1',
      agenteAlvo: 'po',
      projectId: 'proj-1',
      sujeito: 'user-1',
      hipotese: 'prefere uma pergunta por vez',
      sugestao: 'o PO pergunta uma coisa de cada vez',
      fatoDoPerfil: true,
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toContain('FatoDoPerfil');
    expect(run.mock.calls[0][1]).toEqual({
      hypothesisId: 'hyp-1',
      userId: 'user-1',
      projectId: 'proj-1',
      agenteAlvo: 'po',
      hipotese: 'prefere uma pergunta por vez',
      sugestao: 'o PO pergunta uma coisa de cada vez',
      aceitoEm: '2026-10-01T10:00:00.000Z',
    });
    expect(outbox.rows[0].processedAt).not.toBeNull();
  });

  it('RN-680: aceite sem fatoDoPerfil (de terceiro, ou anterior à RN) não grava nada, e a linha conclui', async () => {
    const { run, outbox } = await projetarAceite({
      hypothesisId: 'hyp-1',
      agenteAlvo: 'po',
    });

    expect(run).not.toHaveBeenCalled();
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
    const projector = buildProjector({
      graphRun: run,
      outbox,
      sessionEvents,
      sessions,
    });

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
      new RecordProfileFactUseCase(graph),
      {} as MemoriaDoProjetoTranslator,
    );

    await projector.drainOnce();

    expect(outbox.rows[0].processedAt).toBeNull();
  });

  it('RN-960: o aviso de indisponível diz a causa', async () => {
    const aviso = vi.spyOn(Logger.prototype, 'warn').mockImplementation();
    const outbox = new FakeOutbox();
    const sessionEvents = new FakeSessionEvents();
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
    const graph = unavailableGraphStore(
      new Error('Failed to connect to server'),
    );
    const projector = new GraphProjector(
      outbox,
      sessionEvents,
      new FakeSessions(),
      new RecordHandoffUseCase(graph),
      new RecordHypothesisUseCase(graph),
      new RecordAnamneseProfileUseCase(graph),
      new RecordInteractionUseCase(graph),
      new RecordProfileFactUseCase(graph),
      {} as MemoriaDoProjetoTranslator,
    );

    await projector.drainOnce();

    expect(aviso).toHaveBeenCalledWith(
      expect.stringContaining('Failed to connect to server'),
    );
    aviso.mockRestore();
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
      new RecordProfileFactUseCase(unavailableGraphStore()),
    );
    await down.drainOnce();
    expect(outbox.rows[0].processedAt).toBeNull();

    // Segundo ciclo: grafo voltou — o MESMO item, ainda não processado, é
    // retentado com sucesso.
    const run = vi.fn<GraphTx['run']>().mockResolvedValue({ records: [] });
    const up = buildProjector({
      graphRun: run,
      outbox,
      sessionEvents,
      sessions,
    });
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
    const projector = buildProjector({
      graphRun: run,
      outbox,
      sessionEvents,
      sessions,
    });

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
    const projector = buildProjector({
      graphRun: run,
      outbox,
      sessionEvents,
      sessions,
    });

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
    const projector = buildProjector({
      graphRun: run,
      outbox,
      sessionEvents,
      sessions,
    });

    await projector.drainOnce();

    expect(run).not.toHaveBeenCalled();
    expect(outbox.rows[0].processedAt).not.toBeNull();
  });

  describe('merge na branch de trabalho (RN-1163)', () => {
    const linhaDeMerge = async (outbox: FakeOutbox) =>
      outbox.append({
        aggregateType: GRAPH_PROJECTION_AGGREGATE_TYPE,
        aggregateId: 'proj-1',
        eventType: 'project.trunk_merged',
        payload: { projectId: 'proj-1', sessionId: 's', mergedSha: 'sha9' },
      });
    const projetorCom = (outbox: FakeOutbox, memoria: unknown) => {
      const graph = fakeGraphStore(vi.fn());
      return new GraphProjector(
        outbox,
        new FakeSessionEvents(),
        new FakeSessions(),
        new RecordHandoffUseCase(graph),
        new RecordHypothesisUseCase(graph),
        new RecordAnamneseProfileUseCase(graph),
        new RecordInteractionUseCase(graph),
        new RecordProfileFactUseCase(graph),
        memoria as MemoriaDoProjetoTranslator,
      );
    };

    it('projeta a memória na mergedSha e marca processado', async () => {
      const outbox = new FakeOutbox();
      await linhaDeMerge(outbox);
      const projetar = vi.fn().mockResolvedValue(true);

      await projetorCom(outbox, { projetar }).drainOnce();

      expect(projetar).toHaveBeenCalledWith('proj-1', 'sha9');
      expect(outbox.rows[0].processedAt).not.toBeNull();
    });

    it('grafo indisponível mantém a linha para retry', async () => {
      const outbox = new FakeOutbox();
      await linhaDeMerge(outbox);
      const projetar = vi
        .fn()
        .mockRejectedValue(new GraphUnavailableError('fora do ar'));

      await projetorCom(outbox, { projetar }).drainOnce();

      expect(outbox.rows[0].processedAt).toBeNull();
    });
  });
});
