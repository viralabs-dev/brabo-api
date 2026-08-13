import { describe, it, expect, beforeEach } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { ReanalyzeSessionUseCase } from '../../../../src/application/use-cases/execution/reanalyze-session.use-case';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import { PsychologistDisabledError } from '../../../../src/domain/psychologist/psychologist-disabled.error';

const PROJECT = 'proj-1';
const SESSION = 'sess-1';

class FakeEngine {
  chamadas: [string, string][] = [];
  erro: Error | null = null;

  reanalyzeSession(projectId: string, sessionId: string) {
    this.chamadas.push([projectId, sessionId]);
    if (this.erro) return Promise.reject(this.erro);
    return Promise.resolve();
  }
}

let engine: FakeEngine;
let useCase: ReanalyzeSessionUseCase;

beforeEach(() => {
  engine = new FakeEngine();
  useCase = new ReanalyzeSessionUseCase(engine as unknown as ApiToEngineClient);
});

describe('ReanalyzeSessionUseCase', () => {
  it('dispara a reanálise e devolve ok', async () => {
    const r = await useCase.execute(PROJECT, SESSION);

    expect(r).toEqual({ ok: true });
    expect(engine.chamadas).toEqual([[PROJECT, SESSION]]);
  });

  it('Psicólogo desativado globalmente: 503 com motivo, não 500 genérico', async () => {
    engine.erro = new PsychologistDisabledError();
    let capturado: ServiceUnavailableException | null = null;

    try {
      await useCase.execute(PROJECT, SESSION);
    } catch (erro) {
      capturado = erro as ServiceUnavailableException;
    }

    expect(capturado).toBeInstanceOf(ServiceUnavailableException);
    expect(capturado!.getResponse()).toMatchObject({
      reason: 'psychologist_disabled',
    });
    expect(capturado!.getStatus()).toBe(503);
  });

  it('outra falha de transporte sobe intocada — não é reinterpretada como "desativado"', async () => {
    engine.erro = new Error('engine fora do ar');

    await expect(useCase.execute(PROJECT, SESSION)).rejects.toThrow('engine fora do ar');
  });
});
