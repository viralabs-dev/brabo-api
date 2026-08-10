import { describe, it, expect, beforeEach } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { RunAnamneseUseCase } from '../../../../src/application/use-cases/anamnese/run-anamnese.use-case';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import { AnamneseDisabledError } from '../../../../src/domain/anamnese/anamnese-disabled.error';

const PROJECT = 'proj-1';

class FakeEngine {
  chamadas: string[] = [];
  erro: Error | null = null;

  runAnamnese(projectId: string) {
    this.chamadas.push(projectId);
    if (this.erro) return Promise.reject(this.erro);
    return Promise.resolve();
  }
}

let engine: FakeEngine;
let useCase: RunAnamneseUseCase;

beforeEach(() => {
  engine = new FakeEngine();
  useCase = new RunAnamneseUseCase(engine as unknown as ApiToEngineClient);
});

describe('RunAnamneseUseCase', () => {
  it('roda a rodada agora e devolve ok', async () => {
    const r = await useCase.execute(PROJECT);

    expect(r).toEqual({ ok: true });
    expect(engine.chamadas).toEqual([PROJECT]);
  });

  it('Anamnese desativada globalmente: 503 com motivo, não 500 genérico nem 409 confundível com "sem sessão"', async () => {
    engine.erro = new AnamneseDisabledError();
    let capturado: ServiceUnavailableException | null = null;

    try {
      await useCase.execute(PROJECT);
    } catch (erro) {
      capturado = erro as ServiceUnavailableException;
    }

    expect(capturado).toBeInstanceOf(ServiceUnavailableException);
    expect(capturado!.getResponse()).toMatchObject({
      reason: 'anamnese_disabled',
    });
    expect(capturado!.getStatus()).toBe(503);
  });

  it('outra falha de transporte sobe intocada — não é reinterpretada como "desativada"', async () => {
    engine.erro = new Error('engine fora do ar');

    await expect(useCase.execute(PROJECT)).rejects.toThrow('engine fora do ar');
  });
});
