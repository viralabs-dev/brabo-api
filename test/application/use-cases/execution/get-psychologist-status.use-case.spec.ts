import { describe, it, expect, beforeEach } from 'vitest';
import { GetPsychologistStatusUseCase } from '../../../../src/application/use-cases/execution/get-psychologist-status.use-case';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';

class FakeEngine {
  resultado: { enabled: boolean } = { enabled: false };
  chamadas = 0;

  getPsychologistStatus() {
    this.chamadas += 1;
    return Promise.resolve(this.resultado);
  }
}

let engine: FakeEngine;
let useCase: GetPsychologistStatusUseCase;

beforeEach(() => {
  engine = new FakeEngine();
  useCase = new GetPsychologistStatusUseCase(engine as unknown as ApiToEngineClient);
});

describe('GetPsychologistStatusUseCase', () => {
  it('devolve enabled: false quando a flag global está desligada — não é bug (RN-454)', async () => {
    engine.resultado = { enabled: false };

    const r = await useCase.execute();

    expect(r).toEqual({ enabled: false });
    expect(engine.chamadas).toBe(1);
  });

  it('devolve enabled: true quando a flag global está ligada', async () => {
    engine.resultado = { enabled: true };

    const r = await useCase.execute();

    expect(r).toEqual({ enabled: true });
  });
});
