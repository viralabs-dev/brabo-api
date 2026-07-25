import { describe, it, expect } from 'vitest';
import { AcceptParallelizationUseCase } from '../../../../src/application/use-cases/execution/accept-parallelization.use-case';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';

function build(engineFails: boolean) {
  const ordem: string[] = [];

  const engineClient = {
    acceptParallelization: () => {
      ordem.push('engine');
      return engineFails
        ? Promise.reject(new Error('Falha no comando ao engine: 409'))
        : Promise.resolve();
    },
  } as unknown as ApiToEngineClient;

  const appendEvent = {
    execute: () => {
      ordem.push('evento');
      return Promise.resolve({});
    },
  } as unknown as AppendSessionEventUseCase;

  return {
    useCase: new AcceptParallelizationUseCase(engineClient, appendEvent),
    ordem,
  };
}

describe('AcceptParallelizationUseCase', () => {
  it('sobe o dev extra e só então registra o aceite no event log', async () => {
    const { useCase, ordem } = build(false);

    await expect(
      useCase.execute('proj-1', 'sess-1', 'api', 'user-1'),
    ).resolves.toEqual({ ok: true });

    expect(ordem).toEqual(['engine', 'evento']);
  });

  it('engine recusando (sem agente base): não grava o evento de aceite', async () => {
    // O event log é imutável — um "paralelização aceita" gravado antes da
    // recusa ficaria no feed para sempre, descrevendo algo que não ocorreu.
    const { useCase, ordem } = build(true);

    await expect(
      useCase.execute('proj-1', 'sess-1', 'api', 'user-1'),
    ).rejects.toThrow('409');

    expect(ordem).toEqual(['engine']);
  });
});
