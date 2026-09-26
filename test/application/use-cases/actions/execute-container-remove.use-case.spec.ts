import { describe, it, expect, vi } from 'vitest';
import { ExecuteContainerRemoveUseCase } from '../../../../src/application/use-cases/actions/execute-container-remove.use-case';
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
  executionMode?: ProjectExecutionMode;
  removeContainerViaRunner?: () => Promise<void>;
}) {
  const gravados: { status: string; executionResult: unknown }[] = [];
  const transicoes: Array<{ to: string; input?: unknown }> = [];

  const registrarTransicao = {
    execute: (_p: string, to: string, input?: unknown) => {
      transicoes.push({ to, input });
      return Promise.resolve(makeLifecycle(to as ContainerLifecycleStatus));
    },
  };

  const broker = {
    configurado: () => true,
    start: () =>
      Promise.resolve({ containerId: '', nome: '', jaEstavaDePe: false }),
    stop: () => Promise.resolve(undefined),
    remove: opts.brokerRemove ?? (() => Promise.resolve(undefined)),
    inspect: () => Promise.resolve(null),
    exec: () => Promise.resolve({ exitCode: 0, output: '', timedOut: false }),
  };

  const projects = {
    findById: () =>
      Promise.resolve({
        id: 'proj-1',
        executionMode: opts.executionMode ?? 'container',
        workspaceDirName: 'proj-1-abc12345',
      }),
  };

  const apiToEngineClient = {
    removeContainerViaRunner: vi.fn(
      opts.removeContainerViaRunner ?? (() => Promise.resolve(undefined)),
    ),
  };

  const useCase = new ExecuteContainerRemoveUseCase(
    { runInTransaction: (fn: () => unknown) => Promise.resolve(fn()) } as never,
    {
      updateExecutionResult: (
        _id: string,
        input: { status: string; executionResult: unknown },
      ) => {
        gravados.push(input);
        return Promise.resolve({ ...makeAction(), ...input });
      },
    } as never,
    { execute: () => Promise.resolve(undefined) } as never,
    { append: () => Promise.resolve(undefined) } as never,
    {
      execute: () =>
        Promise.resolve(opts.cicloAtual === undefined ? null : opts.cicloAtual),
    } as never,
    registrarTransicao as never,
    broker,
    projects as never,
    apiToEngineClient as never,
  );

  return { useCase, gravados, transicoes, broker, apiToEngineClient };
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
      (gravados.at(-1)?.executionResult as { statusFinal: string }).statusFinal,
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
      brokerRemove: () => {
        return Promise.reject(
          new BrokerRecusouError(409, 'projeto no modo errado', 'politica'),
        );
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
      brokerRemove: () => {
        return Promise.reject(
          new BrokerIndisponivelError('sem-resposta', 'timeout'),
        );
      },
    });

    await expect(
      useCase.execute('proj-1', 'sess-1', makeAction()),
    ).resolves.toBeDefined();
    expect(gravados.at(-1)?.status).toBe('failed');
  });
});

describe('ExecuteContainerRemoveUseCase — a ramificação é por DESTINO (ADR 0137, RN-503)', () => {
  it('projeto "mounted" remove pelo BROKER — o container dele existe no SERVIDOR', async () => {
    // Um `remove` pelo runner deixaria órfão no servidor um container que a
    // tabela passaria a chamar de `removed`.
    const { useCase, gravados, transicoes, apiToEngineClient, broker } = build({
      executionMode: 'mounted',
      cicloAtual: makeLifecycle('running'),
    });
    const brokerRemove = vi.spyOn(broker, 'remove');

    await useCase.execute('proj-1', 'sess-1', makeAction());

    expect(apiToEngineClient.removeContainerViaRunner).not.toHaveBeenCalled();
    expect(brokerRemove).toHaveBeenCalledWith('proj-1');
    expect(transicoes.map((t) => t.to)).toEqual(['stopped', 'removed']);
    expect(gravados.at(-1)?.status).toBe('executed');
  });

  it('projeto "runner": pede ao engine via ApiToEngineClient, nunca ao broker', async () => {
    const { useCase, gravados, transicoes, apiToEngineClient, broker } = build({
      executionMode: 'runner',
      cicloAtual: makeLifecycle('running'),
    });
    const brokerRemove = vi.spyOn(broker, 'remove');

    await useCase.execute('proj-1', 'sess-1', makeAction());

    expect(brokerRemove).not.toHaveBeenCalled();
    expect(apiToEngineClient.removeContainerViaRunner).toHaveBeenCalledWith(
      'proj-1',
      'proj-1-abc12345',
    );
    expect(transicoes.map((t) => t.to)).toEqual(['stopped', 'removed']);
    expect(gravados.at(-1)?.status).toBe('executed');
  });

  it('RunnerNaoConectadoError vira failed, nunca propaga, e NÃO transiciona nada', async () => {
    const { useCase, gravados, transicoes } = build({
      executionMode: 'runner',
      cicloAtual: makeLifecycle('running'),
      removeContainerViaRunner: () => {
        return Promise.reject(
          new RunnerNaoConectadoError(
            'not_connected',
            'nenhum runner conectado',
          ),
        );
      },
    });

    await expect(
      useCase.execute('proj-1', 'sess-1', makeAction()),
    ).resolves.toBeDefined();
    expect(transicoes).toEqual([]);
    expect(gravados.at(-1)?.status).toBe('failed');
  });

  it('RunnerRecusouContainerError vira failed, nunca propaga', async () => {
    const { useCase, gravados } = build({
      executionMode: 'runner',
      cicloAtual: makeLifecycle('running'),
      removeContainerViaRunner: () => {
        return Promise.reject(
          new RunnerRecusouContainerError(
            'Docker indisponível na máquina do usuário',
          ),
        );
      },
    });

    await expect(
      useCase.execute('proj-1', 'sess-1', makeAction()),
    ).resolves.toBeDefined();
    expect(gravados.at(-1)?.status).toBe('failed');
  });
});
