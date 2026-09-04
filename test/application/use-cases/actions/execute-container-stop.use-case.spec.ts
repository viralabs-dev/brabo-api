import { describe, it, expect, vi } from 'vitest';
import { ExecuteContainerStopUseCase } from '../../../../src/application/use-cases/actions/execute-container-stop.use-case';
import {
  BrokerIndisponivelError,
  BrokerRecusouError,
} from '../../../../src/application/ports/container-broker.port';
import {
  RunnerNaoConectadoError,
  RunnerRecusouContainerError,
} from '../../../../src/application/ports/api-to-engine-client.port';
import { RECURSOS_PADRAO } from '../../../../src/domain/containers/project-container';
import type { ProposedAction } from '../../../../src/domain/actions/proposed-action.entity';
import type {
  ContainerLifecycleStatus,
  ProjectContainerLifecycle,
} from '../../../../src/domain/containers/container-lifecycle';
import type { ProjectExecutionMode } from '../../../../src/domain/iam/project.entity';

function makeAction(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: 'pa-1',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    seq: 1,
    actionType: 'container_stop',
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
  brokerStop?: () => Promise<void>;
  executionMode?: ProjectExecutionMode;
  stopContainerViaRunner?: () => Promise<void>;
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
    stop: opts.brokerStop ?? (async () => undefined),
    remove: async () => undefined,
    inspect: async () => null,
    exec: async () => ({ exitCode: 0, output: '', timedOut: false }),
  };

  const projects = {
    findById: async () => ({
      id: 'proj-1',
      executionMode: opts.executionMode ?? 'container',
      workspaceDirName: 'proj-1-abc12345',
    }),
  };

  const apiToEngineClient = {
    stopContainerViaRunner: vi.fn(
      opts.stopContainerViaRunner ?? (async () => undefined),
    ),
  };

  const useCase = new ExecuteContainerStopUseCase(
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
    broker,
    projects as never,
    apiToEngineClient as never,
  );

  return { useCase, gravados, transicoes, broker, apiToEngineClient };
}

describe('ExecuteContainerStopUseCase', () => {
  it('registrado "running": pede ao broker e transiciona para stopped', async () => {
    const { useCase, gravados, transicoes } = build({
      cicloAtual: makeLifecycle('running'),
    });

    await useCase.execute('proj-1', 'sess-1', makeAction());

    expect(transicoes.map((t) => t.to)).toEqual(['stopped']);
    expect(gravados.at(-1)?.status).toBe('executed');
    expect(
      (gravados.at(-1)?.executionResult as { statusFinal: string }).statusFinal,
    ).toBe('stopped');
  });

  it('registrado já "stopped": broker é chamado (idempotente), mas NENHUMA transição é gravada', async () => {
    const { useCase, gravados, transicoes } = build({
      cicloAtual: makeLifecycle('stopped'),
    });

    await useCase.execute('proj-1', 'sess-1', makeAction());

    expect(transicoes).toEqual([]);
    expect(gravados.at(-1)?.status).toBe('executed');
    expect(
      (gravados.at(-1)?.executionResult as { statusFinal: string }).statusFinal,
    ).toBe('stopped');
  });

  it('sem linha de ciclo de vida: falha sem chamar o broker', async () => {
    const { useCase, gravados, transicoes } = build({ cicloAtual: null });

    await useCase.execute('proj-1', 'sess-1', makeAction());

    expect(transicoes).toEqual([]);
    expect(gravados.at(-1)?.status).toBe('failed');
  });

  it('registrado "removed": falha — nada para parar', async () => {
    const { useCase, gravados } = build({
      cicloAtual: makeLifecycle('removed'),
    });

    await useCase.execute('proj-1', 'sess-1', makeAction());

    expect(gravados.at(-1)?.status).toBe('failed');
    expect(
      (gravados.at(-1)?.executionResult as { motivo: string }).motivo,
    ).toContain('nada para parar');
  });

  it('BrokerRecusouError vira failed, nunca propaga', async () => {
    const { useCase, gravados } = build({
      cicloAtual: makeLifecycle('running'),
      brokerStop: async () => {
        throw new BrokerRecusouError(409, 'projeto no modo errado', 'politica');
      },
    });

    await expect(
      useCase.execute('proj-1', 'sess-1', makeAction()),
    ).resolves.toBeDefined();
    expect(gravados.at(-1)?.status).toBe('failed');
  });

  it('BrokerIndisponivelError vira failed, nunca propaga', async () => {
    const { useCase, gravados } = build({
      cicloAtual: makeLifecycle('running'),
      brokerStop: async () => {
        throw new BrokerIndisponivelError('sem-resposta', 'timeout');
      },
    });

    await expect(
      useCase.execute('proj-1', 'sess-1', makeAction()),
    ).resolves.toBeDefined();
    expect(gravados.at(-1)?.status).toBe('failed');
  });
});

describe('ExecuteContainerStopUseCase — a ramificação é por DESTINO (ADR 0137, RN-501)', () => {
  it('projeto "mounted" para pelo BROKER — o container dele está no SERVIDOR', async () => {
    // Ele mudou de lado junto com o `start` (RN-501), e tinha de mudar: um
    // `stop` que continuasse indo pelo runner pediria para parar um container
    // que não existe na máquina do usuário, deixando de pé — sem forma de
    // parar — o que está de pé no servidor.
    const { useCase, gravados, transicoes, apiToEngineClient, broker } = build({
      executionMode: 'mounted',
      cicloAtual: makeLifecycle('running'),
    });
    const brokerStop = vi.spyOn(broker, 'stop');

    await useCase.execute('proj-1', 'sess-1', makeAction());

    expect(apiToEngineClient.stopContainerViaRunner).not.toHaveBeenCalled();
    expect(brokerStop).toHaveBeenCalledWith('proj-1');
    expect(transicoes.map((t) => t.to)).toEqual(['stopped']);
    expect(gravados.at(-1)?.status).toBe('executed');
  });

  it('projeto "runner": pede ao engine via ApiToEngineClient, nunca ao broker', async () => {
    const { useCase, gravados, transicoes, apiToEngineClient, broker } = build({
      executionMode: 'runner',
      cicloAtual: makeLifecycle('running'),
    });
    const brokerStop = vi.spyOn(broker, 'stop');

    await useCase.execute('proj-1', 'sess-1', makeAction());

    expect(brokerStop).not.toHaveBeenCalled();
    expect(apiToEngineClient.stopContainerViaRunner).toHaveBeenCalledWith(
      'proj-1',
      'proj-1-abc12345',
    );
    expect(transicoes.map((t) => t.to)).toEqual(['stopped']);
    expect(gravados.at(-1)?.status).toBe('executed');
  });

  it('RunnerNaoConectadoError vira failed, nunca propaga', async () => {
    const { useCase, gravados } = build({
      executionMode: 'runner',
      cicloAtual: makeLifecycle('running'),
      stopContainerViaRunner: async () => {
        throw new RunnerNaoConectadoError(
          'timeout',
          'o runner não respondeu a tempo',
        );
      },
    });

    await expect(
      useCase.execute('proj-1', 'sess-1', makeAction()),
    ).resolves.toBeDefined();
    expect(gravados.at(-1)?.status).toBe('failed');
  });

  it('RunnerRecusouContainerError vira failed, nunca propaga', async () => {
    const { useCase, gravados } = build({
      executionMode: 'runner',
      cicloAtual: makeLifecycle('running'),
      stopContainerViaRunner: async () => {
        throw new RunnerRecusouContainerError(
          'Docker indisponível na máquina do usuário',
        );
      },
    });

    await expect(
      useCase.execute('proj-1', 'sess-1', makeAction()),
    ).resolves.toBeDefined();
    expect(gravados.at(-1)?.status).toBe('failed');
  });
});
