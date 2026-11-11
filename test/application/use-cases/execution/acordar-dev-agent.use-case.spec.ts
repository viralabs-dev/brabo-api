import { describe, it, expect } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { AcordarDevAgentUseCase } from '../../../../src/application/use-cases/execution/acordar-dev-agent.use-case';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';

function build(engine: 'ok' | '409') {
  const eventos: { type: string; actor: unknown; payload: unknown }[] = [];
  const useCase = new AcordarDevAgentUseCase(
    {
      acordarDevAgent: () =>
        engine === '409'
          ? Promise.reject(new ConflictException('o agente não está ocioso'))
          : Promise.resolve(),
    } as unknown as ApiToEngineClient,
    {
      execute: (_p: string, _s: string, e: never) => {
        eventos.push(e);
        return Promise.resolve({});
      },
    } as unknown as AppendSessionEventUseCase,
  );
  return { useCase, eventos };
}

describe('AcordarDevAgentUseCase (AT-906)', () => {
  it('acorda no engine e então grava dev.wake_requested com o usuário como ator', async () => {
    const { useCase, eventos } = build('ok');
    await expect(useCase.execute('p', 's', 'dev-api', 'u1')).resolves.toEqual({
      ok: true,
    });
    expect(eventos).toEqual([
      {
        type: 'dev.wake_requested',
        actor: { kind: 'user', id: 'u1' },
        payload: { agentId: 'dev-api' },
      },
    ]);
  });

  it('409 do engine sobe como 409 e NÃO grava o evento', async () => {
    const { useCase, eventos } = build('409');
    await expect(
      useCase.execute('p', 's', 'dev-api', 'u1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(eventos).toEqual([]);
  });
});
