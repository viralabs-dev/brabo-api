import { describe, it, expect } from 'vitest';
import { RearmDevAgentUseCase } from '../../../../src/application/use-cases/execution/rearm-dev-agent.use-case';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';

function build(engineFails: boolean) {
  const ordem: string[] = [];
  const eventos: {
    type: string;
    actor: { kind: string; id: string };
    payload: Record<string, unknown>;
  }[] = [];

  const engineClient = {
    rearmDevAgent: () => {
      ordem.push('engine');
      return engineFails
        ? Promise.reject(new Error('Falha no comando ao engine: 404'))
        : Promise.resolve();
    },
  } as unknown as ApiToEngineClient;

  const appendEvent = {
    execute: (
      _p: string,
      _s: string,
      e: {
        type: string;
        actor: { kind: string; id: string };
        payload: Record<string, unknown>;
      },
    ) => {
      ordem.push('evento');
      eventos.push(e);
      return Promise.resolve({});
    },
  } as unknown as AppendSessionEventUseCase;

  return {
    useCase: new RearmDevAgentUseCase(engineClient, appendEvent),
    ordem,
    eventos,
  };
}

describe('RearmDevAgentUseCase', () => {
  it('rearma no engine e só então registra o evento, com o USUÁRIO como ator', async () => {
    const { useCase, ordem, eventos } = build(false);

    await expect(
      useCase.execute('proj-1', 'sess-1', 'dev-api', 'user-1'),
    ).resolves.toEqual({ ok: true });

    expect(ordem).toEqual(['engine', 'evento']);
    expect(eventos).toEqual([
      {
        type: 'dev.rearmed',
        actor: { kind: 'user', id: 'user-1' },
        payload: { agentId: 'dev-api' },
      },
    ]);
  });

  it('engine recusando (agente inexistente): NÃO grava o evento', async () => {
    // Mesmo motivo do aceite de paralelização: o event log é imutável, e um
    // "rearmado" gravado antes da recusa ficaria no feed descrevendo algo
    // que nunca aconteceu.
    const { useCase, ordem } = build(true);

    await expect(
      useCase.execute('proj-1', 'sess-1', 'dev-fantasma', 'user-1'),
    ).rejects.toThrow('404');

    expect(ordem).not.toContain('evento');
  });
});
