import { describe, it, expect, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ActivateAgentUseCase } from '../../../../src/application/use-cases/agents/activate-agent.use-case';
import type { SessionRepository } from '../../../../src/application/ports/session-repository.port';
import type { HandoffRepository } from '../../../../src/application/ports/handoff-repository.port';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { Handoff } from '../../../../src/domain/sessions/handoff.entity';

const PROJECT = 'p1';
const SESSION = 's1';
const USER = 'u1';

function handoff(overrides: Partial<Handoff>): Handoff {
  return {
    id: 'h1',
    sessionId: SESSION,
    projectId: PROJECT,
    fromAgent: 'criativo',
    toAgent: 'po',
    artifactId: null,
    status: 'offered',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

class FakeSessions {
  session: unknown = { id: SESSION };
  findInProject() {
    return Promise.resolve(this.session);
  }
}

class FakeHandoffs {
  rows: Handoff[] = [];
  findBySession() {
    return Promise.resolve(this.rows);
  }
}

class FakeEngine {
  startAgentCalls: Array<{ agent: string }> = [];
  startAgent(_p: string, _s: string, agent: string) {
    this.startAgentCalls.push({ agent });
    return Promise.resolve();
  }
}

class FakeAppend {
  calls: Array<{ type: string }> = [];
  execute(_p: string, _s: string, input: { type: string }) {
    this.calls.push({ type: input.type });
    return Promise.resolve({} as never);
  }
}

let sessions: FakeSessions;
let handoffs: FakeHandoffs;
let engine: FakeEngine;
let append: FakeAppend;
let useCase: ActivateAgentUseCase;

beforeEach(() => {
  sessions = new FakeSessions();
  handoffs = new FakeHandoffs();
  engine = new FakeEngine();
  append = new FakeAppend();
  useCase = new ActivateAgentUseCase(
    sessions as unknown as SessionRepository,
    handoffs as unknown as HandoffRepository,
    engine as unknown as ApiToEngineClient,
    append as unknown as AppendSessionEventUseCase,
  );
});

describe('ActivateAgentUseCase', () => {
  it('rejeita ativar "po" sem handoff aceito — sem chamar o engine nem logar', async () => {
    await expect(
      useCase.execute(PROJECT, SESSION, 'po', USER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(engine.startAgentCalls).toHaveLength(0);
    expect(append.calls).toHaveLength(0);
  });

  it('ativa o Criativo por comando do usuário (sem handoff)', async () => {
    const res = await useCase.execute(PROJECT, SESSION, 'criativo', USER);
    expect(res).toEqual({ agent: 'criativo', status: 'active' });
    expect(engine.startAgentCalls).toEqual([{ agent: 'criativo' }]);
    expect(append.calls).toEqual([{ type: 'agent.activated' }]);
  });

  it('ativa "po" quando existe handoff accepted endereçado a ele', async () => {
    handoffs.rows = [handoff({ toAgent: 'po', status: 'accepted' })];
    const res = await useCase.execute(PROJECT, SESSION, 'po', USER);
    expect(res.agent).toBe('po');
    expect(engine.startAgentCalls).toEqual([{ agent: 'po' }]);
    expect(append.calls).toEqual([{ type: 'agent.activated' }]);
  });
});
