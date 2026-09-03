import { describe, it, expect } from 'vitest';
import { ExecuteContainerRemoveUseCase } from '../../../../src/application/use-cases/actions/execute-container-remove.use-case';
import {
  BrokerIndisponivelError,
  BrokerRecusouError,
} from '../../../../src/application/ports/container-broker.port';
import { RECURSOS_PADRAO } from '../../../../src/domain/containers/project-container';
import type { ProposedAction } from '../../../../src/domain/actions/proposed-action.entity';
import type {
  ContainerLifecycleStatus,
  ProjectContainerLifecycle,
} from '../../../../src/domain/containers/container-lifecycle';

function makeAction(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: 'pa-1',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    seq: 1,
    actionType: 'container_remove',
    payload: {},
    status: 'approved',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'user', id: 'user-1' },
    decidedBy: 'user-1',
    decidedAt: new Date(),
    rejectionReason: null,
    executionResult: null,
    ...overrides,
  } as unknown as ProposedAction;
}

function makeLifecycle(
  status: ContainerLifecycleStatus,
): ProjectContainerLifecycle {
  return {
    id: 'lc-1',
    projectId: 'proj-1',
    status,
    imageVersion: 1,
    containerId: 'container-1',
    resources: RECURSOS_PADRAO,
    failureReason: null,
    createdAt: new Date(),
    statusChangedAt: new Date(),
  };
}

function build(opts: {
  cicloAtual?: ProjectContainerLifecycle | null;
  brokerRemove?: () => Promise<void>;
}) {
  const gravados: { status: string; executionResult: unknown }[] = [];
  const transicoes: Array<{ to: string; input?: unknown }> = [];

  const registrarTransicao = {
    execute: async (_p: string, to: string, input?: unknown) => {
      transicoes.push({ to, input });
      return makeLifecycle(to as ContainerLifecycleStatus);
    },
  };

  const broker = {
    configurado: () => true,
    start: async () => ({ containerId: '', nome: '', jaEstavaDePe: false }),
    stop: async () => undefined,
    remove: opts.brokerRemove ?? (async () => undefined),
    inspect: async () => null,
    exec: async () => ({ exitCode: 0, output: '', timedOut: false }),
  };

  const useCase = new ExecuteContainerRemoveUseCase(
    { runInTransaction: async (fn: () => unknown) => fn() } as never,
    {
      updateExecutionResult: async (
        _id: string,
        input: { status: string; executionResult: unknown },
      ) => {
        gravados.push(input);
        return { ...makeAction(), ...input };
      },
    } as never,
    { execute: async () => undefined } as never,
    { append: async () => undefined } as never,
    {
      execute: async () =>
        opts.cicloAtual === undefined ? null : opts.cicloAtual,
    } as never,
    registrarTransicao as never,
    broker as never,
  );

  return { useCase, gravados, transicoes };
}

describe('ExecuteContainerRemoveUseCase', () => {
  it('registrado "running": pede ao broker (rm --force) e registra os DOIS hops — stopped, depois removed', async () => {
    const { useCase, gravados, transicoes } = build({
      cicloAtual: makeLifecycle('running'),
    });

    await useCase.execute('proj-1', 'sess-1', makeAction());

    expect(transicoes.map((t) => t.to)).toEqual(['stopped', 'removed']);
    expect(gravados.at(-1)?.status).toBe('executed');
    expect(
      (gravados.at(-1)?.executionResult as { statusFinal: string })
        .statusFinal,
    ).toBe('removed');
  });

  it('registrado "stopped": UM hop só — removed direto', async () => {
    const { useCase, transicoes } = build({
      cicloAtual: makeLifecycle('stopped'),
    });

    await useCase.execute('proj-1', 'sess-1', makeAction());

    expect(transicoes.map((t) => t.to)).toEqual(['removed']);
  });

  it('registrado "failed": UM hop só — removed direto', async () => {
    const { useCase, transicoes } = build({
      cicloAtual: makeLifecycle('failed'),
    });

    await useCase.execute('proj-1', 'sess-1', makeAction());

    expect(transicoes.map((t) => t.to)).toEqual(['removed']);
  });

  it('sem linha de ciclo de vida: falha sem chamar o broker', async () => {
    const { useCase, gravados, transicoes } = build({ cicloAtual: null });

    await useCase.execute('proj-1', 'sess-1', makeAction());

    expect(transicoes).toEqual([]);
    expect(gravados.at(-1)?.status).toBe('failed');
  });

  it('registrado "removed": falha — nada para remover, idempotente sem regravar', async () => {
    const { useCase, gravados, transicoes } = build({
      cicloAtual: makeLifecycle('removed'),
    });

    await useCase.execute('proj-1', 'sess-1', makeAction());

    expect(transicoes).toEqual([]);
    expect(gravados.at(-1)?.status).toBe('failed');
    expect(
      (gravados.at(-1)?.executionResult as { motivo: string }).motivo,
    ).toContain('nada para remover');
  });

  it('BrokerRecusouError vira failed, nunca propaga, e NÃO transiciona nada', async () => {
    const { useCase, gravados, transicoes } = build({
      cicloAtual: makeLifecycle('running'),
      brokerRemove: async () => {
        throw new BrokerRecusouError(409, 'projeto no modo errado', 'politica');
      },
    });

    await expect(
      useCase.execute('proj-1', 'sess-1', makeAction()),
    ).resolves.toBeDefined();
    expect(transicoes).toEqual([]);
    expect(gravados.at(-1)?.status).toBe('failed');
  });

  it('BrokerIndisponivelError vira failed, nunca propaga', async () => {
    const { useCase, gravados } = build({
      cicloAtual: makeLifecycle('running'),
      brokerRemove: async () => {
        throw new BrokerIndisponivelError('sem-resposta', 'timeout');
      },
    });

    await expect(
      useCase.execute('proj-1', 'sess-1', makeAction()),
    ).resolves.toBeDefined();
    expect(gravados.at(-1)?.status).toBe('failed');
  });
});
