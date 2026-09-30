import { describe, expect, it } from 'vitest';
import {
  decidirAceiteImplicitoDoPo,
  MARCA_DO_ESTOU_PRONTO,
} from '../../../src/domain/sessions/estou-pronto';
import type { SessionEvent } from '../../../src/domain/sessions/session-event.entity';

/**
 * RN-658 (ADR 0185): quando a oferta Criativo→PO é aceita em nome de quem
 * clicou "Estou pronto — a necessidade está validada".
 */
const SESSION = 's1';

function evento(
  id: string,
  seq: number,
  type: string,
  actor: SessionEvent['actor'],
  payload: unknown,
): SessionEvent {
  return {
    id,
    sessionId: SESSION,
    seq,
    type,
    actor,
    payload,
    createdAt: new Date(),
  };
}

const clique = (seq: number, payload: unknown = { ...MARCA_DO_ESTOU_PRONTO }) =>
  evento(
    `pronto-${seq}`,
    seq,
    'readiness.confirmed',
    { kind: 'user', id: 'u1' },
    payload,
  );
const brief = (id: string, seq: number) =>
  evento(
    id,
    seq,
    'artifact.product_brief',
    { kind: 'agent', id: 'criativo' },
    {},
  );

const oferta = {
  sessionId: SESSION,
  fromAgent: 'criativo',
  toAgent: 'po',
  status: 'offered' as const,
  artifactId: 'brief-2',
};

describe('decidirAceiteImplicitoDoPo', () => {
  it('aceita pela pessoa do clique a oferta que leva o brief nascido DEPOIS dele', () => {
    const decisao = decidirAceiteImplicitoDoPo(
      oferta,
      SESSION,
      [clique(3)],
      [brief('brief-1', 1), brief('brief-2', 5)],
    );

    expect(decisao).toEqual({
      userId: 'u1',
      implicito: { via: 'readiness.confirmed', readinessEventId: 'pronto-3' },
    });
  });

  it('recusa o brief ANTERIOR ao clique: não foi o clique que o pediu', () => {
    expect(
      decidirAceiteImplicitoDoPo(
        { ...oferta, artifactId: 'brief-1' },
        SESSION,
        [clique(3)],
        [brief('brief-1', 1)],
      ),
    ).toBeNull();
  });

  it('recusa o `readiness.confirmed` sem a marca (gravado antes do ADR 0185)', () => {
    expect(
      decidirAceiteImplicitoDoPo(
        oferta,
        SESSION,
        [clique(3, {})],
        [brief('brief-2', 5)],
      ),
    ).toBeNull();
  });

  it('recusa handoff sem artefato (o manual, RN-633), a outro destino, de outra sessão ou já decidido', () => {
    const prontidoes = [clique(3)];
    const briefs = [brief('brief-2', 5)];
    const decidir = (o: typeof oferta | Record<string, unknown>) =>
      decidirAceiteImplicitoDoPo(
        { ...oferta, ...o },
        SESSION,
        prontidoes,
        briefs,
      );

    expect(decidir({ artifactId: null })).toBeNull();
    expect(decidir({ toAgent: 'arquiteto' })).toBeNull();
    expect(decidir({ sessionId: 'outra' })).toBeNull();
    expect(decidir({ status: 'accepted' })).toBeNull();
  });
});
