import { describe, it, expect, beforeEach } from 'vitest';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AceiteImplicitoDoPoUseCase } from '../../../../src/application/use-cases/agents/aceite-implicito-do-po.use-case';
import type { SessionEventRepository } from '../../../../src/application/ports/session-event-repository.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { AcceptHandoffUseCase } from '../../../../src/application/use-cases/agents/accept-handoff.use-case';
import type { SessionEvent } from '../../../../src/domain/sessions/session-event.entity';
import { MARCA_DO_ESTOU_PRONTO } from '../../../../src/domain/sessions/estou-pronto';

/**
 * RN-658 (ADR 0185, AT-312): o handoff Criativo→PO que o "Estou pronto" pediu
 * é aceito em nome de quem clicou, pelo MESMO `AcceptHandoffUseCase` do card.
 */
const PROJECT = 'p1';
const SESSION = 's1';

function evento(
  id: string,
  seq: number,
  type: string,
  payload: unknown,
): SessionEvent {
  return {
    id,
    sessionId: SESSION,
    seq,
    type,
    actor:
      type === 'readiness.confirmed'
        ? { kind: 'user', id: 'u1' }
        : { kind: 'agent', id: 'criativo' },
    payload,
    createdAt: new Date(),
  };
}

class FakeSessionEvents {
  porTipo: Record<string, SessionEvent[]> = {
    'readiness.confirmed': [
      evento('pronto', 3, 'readiness.confirmed', { ...MARCA_DO_ESTOU_PRONTO }),
    ],
    'artifact.product_brief': [
      evento('brief', 5, 'artifact.product_brief', {}),
    ],
  };
  listByTypeInSession(_s: string, type: string) {
    return Promise.resolve(this.porTipo[type] ?? []);
  }
}

class FakeAccept {
  erro: Error | null = null;
  chamadas: unknown[][] = [];
  execute(...args: unknown[]) {
    this.chamadas.push(args);
    return this.erro ? Promise.reject(this.erro) : Promise.resolve({});
  }
}

class FakeAppendEvent {
  eventos: {
    type: string;
    actor: unknown;
    payload: Record<string, unknown>;
  }[] = [];
  execute(
    _p: string,
    _s: string,
    e: { type: string; actor: unknown; payload: Record<string, unknown> },
  ) {
    this.eventos.push(e);
    return Promise.resolve({} as never);
  }
}

const oferta = {
  id: 'h1',
  sessionId: SESSION,
  fromAgent: 'criativo',
  toAgent: 'po',
  status: 'offered' as const,
  artifactId: 'brief',
};

let sessionEvents: FakeSessionEvents;
let accept: FakeAccept;
let append: FakeAppendEvent;
let uc: AceiteImplicitoDoPoUseCase;

beforeEach(() => {
  sessionEvents = new FakeSessionEvents();
  accept = new FakeAccept();
  append = new FakeAppendEvent();
  uc = new AceiteImplicitoDoPoUseCase(
    sessionEvents as unknown as SessionEventRepository,
    accept as unknown as AcceptHandoffUseCase,
    append as unknown as AppendSessionEventUseCase,
  );
});

describe('AceiteImplicitoDoPoUseCase', () => {
  it('aceita a oferta em nome de quem clicou, com a marca de implícito', async () => {
    await expect(uc.seCouber(PROJECT, SESSION, oferta)).resolves.toBe(true);

    expect(accept.chamadas).toEqual([
      [
        PROJECT,
        SESSION,
        'h1',
        'u1',
        { via: 'readiness.confirmed', readinessEventId: 'pronto' },
      ],
    ]);
    expect(append.eventos).toEqual([]);
  });

  it('sem clique marcado (sessão antiga), não aceita: a oferta fica para o card', async () => {
    sessionEvents.porTipo['readiness.confirmed'] = [
      evento('pronto', 3, 'readiness.confirmed', {}),
    ];

    await expect(uc.seCouber(PROJECT, SESSION, oferta)).resolves.toBe(false);
    expect(accept.chamadas).toEqual([]);
  });

  it('falha do aceite vira `agent.error` durável com origem, e não sobe para o engine', async () => {
    accept.erro = new ServiceUnavailableException('engine fora');

    await expect(uc.seCouber(PROJECT, SESSION, oferta)).resolves.toBe(false);

    expect(append.eventos).toHaveLength(1);
    expect(append.eventos[0]).toMatchObject({
      type: 'agent.error',
      actor: { kind: 'system', id: 'aceite-implicito' },
      payload: {
        origem: 'infra',
        reason: 'aceite_implicito_falhou',
        handoffId: 'h1',
      },
    });
  });

  it('oferta já decidida por outro caminho (400 "não está offered") não é falha', async () => {
    accept.erro = new BadRequestException('Handoff não está "offered"');

    await expect(uc.seCouber(PROJECT, SESSION, oferta)).resolves.toBe(false);
    expect(append.eventos).toEqual([]);
  });
});
