import { describe, it, expect, beforeEach } from 'vitest';
import { ValidateNecessityUseCase } from '../../../../src/application/use-cases/agents/validate-necessity.use-case';
import type { SessionEventRepository } from '../../../../src/application/ports/session-event-repository.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { SessionEvent } from '../../../../src/domain/sessions/session-event.entity';

const PROJECT = 'p1';
const SESSION = 's1';

function briefEvent(id: string, seq: number): SessionEvent {
  return {
    id,
    sessionId: SESSION,
    seq,
    type: 'artifact.product_brief',
    actor: { kind: 'agent', id: 'criativo' },
    payload: { title: 'Product Brief', summary: 'resumo', rules: [] },
    createdAt: new Date(),
  } as SessionEvent;
}

class FakeSessionEvents {
  briefs: SessionEvent[] = [];
  listByTypeInSession(_sessionId: string, type: string) {
    if (type !== 'artifact.product_brief') return Promise.resolve([]);
    return Promise.resolve(this.briefs);
  }
}

class FakeAppendEvent {
  eventos: { type: string; actor: unknown; payload: unknown }[] = [];
  execute(
    _p: string,
    _s: string,
    evento: { type: string; actor: unknown; payload: unknown },
  ) {
    this.eventos.push(evento);
    return Promise.resolve({} as never);
  }
}

let sessionEvents: FakeSessionEvents;
let appendEvent: FakeAppendEvent;
let uc: ValidateNecessityUseCase;

beforeEach(() => {
  sessionEvents = new FakeSessionEvents();
  appendEvent = new FakeAppendEvent();
  uc = new ValidateNecessityUseCase(
    sessionEvents as unknown as SessionEventRepository,
    appendEvent as unknown as AppendSessionEventUseCase,
  );
});

describe('ValidateNecessityUseCase', () => {
  it('RN-406: sem product_brief nenhum, recusa ANTES de gravar qualquer evento', async () => {
    sessionEvents.briefs = [];

    await expect(uc.execute(PROJECT, SESSION, 'user-1')).rejects.toThrow();

    expect(appendEvent.eventos).toEqual([]);
  });

  it('com product_brief consolidado, grava necessity.validated referenciando o MAIS RECENTE', async () => {
    sessionEvents.briefs = [briefEvent('brief-1', 1), briefEvent('brief-2', 2)];

    const resultado = await uc.execute(PROJECT, SESSION, 'user-1');

    expect(resultado).toEqual({ ok: true });
    expect(appendEvent.eventos).toHaveLength(1);
    expect(appendEvent.eventos[0]).toMatchObject({
      type: 'necessity.validated',
      actor: { kind: 'user', id: 'user-1' },
      payload: { productBriefId: 'brief-2' },
    });
  });
});
