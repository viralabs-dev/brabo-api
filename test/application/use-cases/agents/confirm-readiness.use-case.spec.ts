import { describe, it, expect, beforeEach } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import { ConfirmReadinessUseCase } from '../../../../src/application/use-cases/agents/confirm-readiness.use-case';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';

/**
 * "Estou pronto — a necessidade está validada" (ADR 0185): um clique, os dois
 * gates (RN-657), e a marca que o aceite implícito do PO lê depois (RN-658).
 */
const PROJECT = 'p1';
const SESSION = 's1';

class FakeAppendEvent {
  eventos: { type: string; actor: unknown; payload: unknown }[] = [];
  execute(
    _p: string,
    _s: string,
    evento: { type: string; actor: unknown; payload: unknown },
  ) {
    this.eventos.push(evento);
    return Promise.resolve({ id: `ev-${this.eventos.length}` } as never);
  }
}

class FakeEngine {
  erro: Error | null = null;
  chamadas = 0;
  confirmReadiness() {
    this.chamadas += 1;
    return this.erro ? Promise.reject(this.erro) : Promise.resolve();
  }
}

let append: FakeAppendEvent;
let engine: FakeEngine;
let uc: ConfirmReadinessUseCase;

beforeEach(() => {
  append = new FakeAppendEvent();
  engine = new FakeEngine();
  uc = new ConfirmReadinessUseCase(
    engine as unknown as ApiToEngineClient,
    append as unknown as AppendSessionEventUseCase,
  );
});

describe('ConfirmReadinessUseCase', () => {
  it('RN-657: grava a prontidão marcada e, aceito o turno, a necessidade validada com o brief ainda por vir', async () => {
    const resultado = await uc.execute(PROJECT, SESSION, 'u1');

    expect(resultado).toEqual({ ok: true });
    expect(engine.chamadas).toBe(1);
    expect(append.eventos).toEqual([
      {
        type: 'readiness.confirmed',
        actor: { kind: 'user', id: 'u1' },
        payload: { necessidadeValidada: true, aceiteImplicitoDoPo: true },
      },
      {
        type: 'necessity.validated',
        actor: { kind: 'user', id: 'u1' },
        payload: {
          productBriefId: null,
          via: 'readiness.confirmed',
          readinessEventId: 'ev-1',
        },
      },
    ]);
  });

  it('RN-657: recusa do engine (422 sem regra de negócio) sobe e a necessidade NÃO fica validada', async () => {
    engine.erro = new UnprocessableEntityException('sem_regra_de_negocio');

    await expect(uc.execute(PROJECT, SESSION, 'u1')).rejects.toBe(engine.erro);

    expect(append.eventos.map((e) => e.type)).toEqual(['readiness.confirmed']);
  });
});
