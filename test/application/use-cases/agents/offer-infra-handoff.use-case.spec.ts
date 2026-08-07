import { describe, it, expect, beforeEach } from 'vitest';
import { OfferInfraHandoffUseCase } from '../../../../src/application/use-cases/agents/offer-infra-handoff.use-case';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';

const PROJECT = 'p1';
const SESSION = 's1';

class FakeEngine {
  chamadas: string[] = [];
  falharDev = false;

  offerInfraHandoff() {
    this.chamadas.push('infra');
    return Promise.resolve();
  }

  offerDevHandoff() {
    if (this.falharDev) return Promise.reject(new Error('dev-lead fora do ar'));
    this.chamadas.push('dev');
    return Promise.resolve();
  }
}

class FakeEvents {
  tipos: string[] = [];
  execute(_p: string, _s: string, evento: { type: string }) {
    this.tipos.push(evento.type);
    return Promise.resolve({} as never);
  }
}

let engine: FakeEngine;
let events: FakeEvents;
let uc: OfferInfraHandoffUseCase;

beforeEach(() => {
  engine = new FakeEngine();
  events = new FakeEvents();
  uc = new OfferInfraHandoffUseCase(
    engine as unknown as ApiToEngineClient,
    events as unknown as AppendSessionEventUseCase,
  );
});

describe('OfferInfraHandoffUseCase', () => {
  it('a confirmação de arquitetura pronta entrega às DUAS áreas', async () => {
    // FASE 14d: a cadeia vira Arquiteto → Dev Lead → execução. Antes não havia
    // ninguém entre o fim da arquitetura e o botão de ativar.
    await uc.execute(PROJECT, SESSION, 'user-1');

    expect(engine.chamadas).toEqual(['infra', 'dev']);
  });

  it('grava o marco de arquitetura pronta antes de sinalizar', async () => {
    await uc.execute(PROJECT, SESSION, 'user-1');

    expect(events.tipos).toEqual(['architecture.readiness_confirmed']);
  });

  it('Infra vem PRIMEIRO: uma falha do Dev Lead não desfaz o que já foi aceito', async () => {
    // As duas chamadas são independentes de propósito. O event log é imutável
    // — um handoff de Infra já ofertado não teria como ser retratado se a
    // ordem fosse a inversa e o dev falhasse depois.
    engine.falharDev = true;

    await expect(uc.execute(PROJECT, SESSION, 'user-1')).rejects.toThrow();

    expect(engine.chamadas).toEqual(['infra']);
  });
});
