import { describe, it, expect, vi } from 'vitest';
import { ExecuteContainerStartUseCase } from '../../../../src/application/use-cases/actions/execute-container-start.use-case';
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
import type { EstadoDoRoteamento } from '../../../../src/domain/architecture/module-routing';
import type { ProjectContainerLifecycle } from '../../../../src/domain/containers/container-lifecycle';
import type { ProjectExecutionMode } from '../../../../src/domain/iam/project.entity';

const IMAGEM_CANDIDATA = 'node:22-bookworm-slim';

function makeAction(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: 'pa-1',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    seq: 1,
    actionType: 'container_start',
    payload: {
      imagem: IMAGEM_CANDIDATA,
      network: 'none',
      resources: RECURSOS_PADRAO,
      rationale: 'É a candidata do módulo api, mesma stack.',
    },
    status: 'auto_approved',
    resolvedPolicy: 'auto_approve',
    actor: { kind: 'agent', id: 'infra' },
    decidedBy: null,
    decidedAt: null,
    rejectionReason: null,
    executionResult: null,
    ...overrides,
  } as unknown as ProposedAction;
}

const roteamentoComCandidata: EstadoDoRoteamento = {
  status: 'roteado',
  roteamento: [
    { modulo: 'api', imagemCandidata: IMAGEM_CANDIDATA, porque: 'TS/Node' },
  ],
  version: 1,
  eventId: 'evt-1',
  createdAt: new Date().toISOString(),
};

function build(opts: {
  roteamento?: EstadoDoRoteamento;
  cicloAtual?: ProjectContainerLifecycle | null;
  brokerStart?: () => Promise<{
    containerId: string;
    nome: string;
    jaEstavaDePe: boolean;
  }>;
  executionMode?: ProjectExecutionMode;
  spec?: {
    imagem: { image: string; network: 'none' | 'egress'; resources: typeof RECURSOS_PADRAO } | null;
    imagemVersao: number;
  };
  startContainerViaRunner?: () => Promise<{
    containerId: string;
    nome: string;
    jaEstavaDePe: boolean;
  }>;
}) {
  const gravados: { status: string; executionResult: unknown }[] = [];
  const transicoes: Array<{ to: string; input?: unknown }> = [];
  const decidirImagemChamadas: unknown[] = [];

  const decidirImagem = {
    execute: vi.fn(async (_p: string, _s: string, input: unknown) => {
      decidirImagemChamadas.push(input);
      return {
        decisao: {
          image: (input as { image: string }).image,
          rationale: (input as { rationale: string }).rationale,
          network: (input as { network: 'none' | 'egress' }).network,
          resources: (input as { resources: typeof RECURSOS_PADRAO })
            .resources,
        },
        version: 2,
      };
    }),
  };

  const registrarTransicao = {
    execute: vi.fn(async (_p: string, to: string, input?: unknown) => {
      transicoes.push({ to, input });
      return {} as ProjectContainerLifecycle;
    }),
  };

  const broker = {
    configurado: () => true,
    start:
      opts.brokerStart ??
      (async () => ({
        containerId: 'container-1',
        nome: 'brabo-proj-1',
        jaEstavaDePe: false,
      })),
    stop: async () => undefined,
    remove: async () => undefined,
    inspect: async () => null,
    exec: async () => ({ exitCode: 0, output: '', timedOut: false }),
  };

  const projects = {
    findById: async () => ({
      id: 'proj-1',
      executionMode: opts.executionMode ?? 'container',
      workspaceDirName: 'proj-1-abc12345',
      slug: 'proj-1',
      workspaceId: 'ws-1',
    }),
  };

  const obterSpec = {
    execute: async () =>
      opts.spec ?? {
        projectId: 'proj-1',
        projectSlug: 'proj-1',
        workspaceId: 'ws-1',
        workspaceDirName: 'proj-1-abc12345',
        executionMode: opts.executionMode ?? 'runner',
        imagem: {
          image: IMAGEM_CANDIDATA,
          network: 'none' as const,
          resources: RECURSOS_PADRAO,
        },
        imagemVersao: 3,
      },
  };

  const startContainerViaRunner =
    opts.startContainerViaRunner ??
    (async () => ({
      containerId: 'container-runner-1',
      nome: 'brabo-proj-1-abc12345',
      jaEstavaDePe: false,
    }));

  const apiToEngineClient = {
    startContainerViaRunner: vi.fn(startContainerViaRunner),
  };

  const useCase = new ExecuteContainerStartUseCase(
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
      execute: async () => opts.roteamento ?? roteamentoComCandidata,
    } as never,
    decidirImagem as never,
    {
      execute: async () =>
        opts.cicloAtual === undefined ? null : opts.cicloAtual,
    } as never,
    registrarTransicao as never,
    broker as never,
    projects as never,
    obterSpec as never,
    apiToEngineClient as never,
  );

  return {
    useCase,
    gravados,
    transicoes,
    decidirImagemChamadas,
    decidirImagem,
    broker,
    apiToEngineClient,
  };
}

describe('ExecuteContainerStartUseCase — caminho feliz', () => {
  it('elege a imagem candidatada, sobe pelo broker e transiciona provisioning->running quando não há linha ainda', async () => {
    const { useCase, gravados, transicoes, decidirImagem } = build({
      cicloAtual: null,
    });

    await useCase.execute('proj-1', 'sess-1', makeAction());

    expect(decidirImagem.execute).toHaveBeenCalledWith(
      'proj-1',
      'sess-1',
      expect.objectContaining({ image: IMAGEM_CANDIDATA }),
      'infra-lead',
    );
    expect(transicoes.map((t) => t.to)).toEqual(['provisioning', 'running']);
    expect(gravados.at(-1)?.status).toBe('executed');
    expect(
      (gravados.at(-1)?.executionResult as { imagem: string }).imagem,
    ).toBe(IMAGEM_CANDIDATA);
  });

  it('linha em "stopped" pula direto para running — não reprovisiona', async () => {
    const { useCase, transicoes } = build({
      cicloAtual: {
        id: 'lc-1',
        projectId: 'proj-1',
        status: 'stopped',
        imageVersion: 1,
        containerId: 'old-container',
        resources: RECURSOS_PADRAO,
        failureReason: null,
        createdAt: new Date(),
        statusChangedAt: new Date(),
      },
    });

    await useCase.execute('proj-1', 'sess-1', makeAction());

    expect(transicoes.map((t) => t.to)).toEqual(['running']);
  });

  it('linha já "running" não transiciona nada — broker idempotente', async () => {
    const { useCase, transicoes, gravados } = build({
      cicloAtual: {
        id: 'lc-1',
        projectId: 'proj-1',
        status: 'running',
        imageVersion: 1,
        containerId: 'container-1',
        resources: RECURSOS_PADRAO,
        failureReason: null,
        createdAt: new Date(),
        statusChangedAt: new Date(),
      },
      brokerStart: async () => ({
        containerId: 'container-1',
        nome: 'brabo-proj-1',
        jaEstavaDePe: true,
      }),
    });

    await useCase.execute('proj-1', 'sess-1', makeAction());

    expect(transicoes).toEqual([]);
    expect(gravados.at(-1)?.status).toBe('executed');
    expect(
      (gravados.at(-1)?.executionResult as { jaEstavaDePe: boolean })
        .jaEstavaDePe,
    ).toBe(true);
  });
});

describe('ExecuteContainerStartUseCase — imagem fora das candidatas', () => {
  it('recusa sem chamar DecidirImagemDoProjetoUseCase nem o broker', async () => {
    const { useCase, gravados, decidirImagem, broker } = build({
      roteamento: {
        status: 'roteado',
        roteamento: [
          {
            modulo: 'worker',
            imagemCandidata: 'python:3.12-slim',
            porque: 'outra stack',
          },
        ],
        version: 1,
        eventId: 'evt-2',
        createdAt: new Date().toISOString(),
      },
    });
    const brokerStart = vi.spyOn(broker, 'start');

    await useCase.execute('proj-1', 'sess-1', makeAction());

    expect(decidirImagem.execute).not.toHaveBeenCalled();
    expect(brokerStart).not.toHaveBeenCalled();
    expect(gravados.at(-1)?.status).toBe('failed');
    expect(
      (gravados.at(-1)?.executionResult as { motivo: string }).motivo,
    ).toContain(IMAGEM_CANDIDATA);
  });
});

describe('ExecuteContainerStartUseCase — recusa do broker', () => {
  it('BrokerRecusouError vira failed, nunca propaga', async () => {
    const { useCase, gravados } = build({
      brokerStart: async () => {
        throw new BrokerRecusouError(409, 'projeto no modo errado', 'politica');
      },
    });

    await expect(
      useCase.execute('proj-1', 'sess-1', makeAction()),
    ).resolves.toBeDefined();
    expect(gravados.at(-1)?.status).toBe('failed');
    expect(
      (gravados.at(-1)?.executionResult as { motivo: string }).motivo,
    ).toContain('projeto no modo errado');
  });

  it('BrokerIndisponivelError vira failed, nunca propaga', async () => {
    const { useCase, gravados } = build({
      brokerStart: async () => {
        throw new BrokerIndisponivelError('sem-resposta', 'timeout');
      },
    });

    await expect(
      useCase.execute('proj-1', 'sess-1', makeAction()),
    ).resolves.toBeDefined();
    expect(gravados.at(-1)?.status).toBe('failed');
  });
});

describe('ExecuteContainerStartUseCase — mounted/runner (ADR 0137)', () => {
  it('projeto "runner": pede ao engine via ApiToEngineClient, nunca ao broker', async () => {
    const { useCase, gravados, transicoes, apiToEngineClient, broker } = build({
      executionMode: 'runner',
      cicloAtual: null,
    });
    const brokerStart = vi.spyOn(broker, 'start');

    await useCase.execute('proj-1', 'sess-1', makeAction());

    expect(brokerStart).not.toHaveBeenCalled();
    expect(apiToEngineClient.startContainerViaRunner).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({ imagem: IMAGEM_CANDIDATA }),
    );
    expect(transicoes.map((t) => t.to)).toEqual(['provisioning', 'running']);
    expect(gravados.at(-1)?.status).toBe('executed');
  });

  it('sem imagem decidida (RN-105): falha sem chamar o engine', async () => {
    const { useCase, gravados, apiToEngineClient } = build({
      executionMode: 'mounted',
      spec: { imagem: null, imagemVersao: 0 },
    });

    await useCase.execute('proj-1', 'sess-1', makeAction());

    expect(apiToEngineClient.startContainerViaRunner).not.toHaveBeenCalled();
    expect(gravados.at(-1)?.status).toBe('failed');
    expect(
      (gravados.at(-1)?.executionResult as { motivo: string }).motivo,
    ).toContain('RN-105');
  });

  it('RunnerNaoConectadoError vira failed, nunca propaga', async () => {
    const { useCase, gravados } = build({
      executionMode: 'runner',
      startContainerViaRunner: async () => {
        throw new RunnerNaoConectadoError(
          'not_connected',
          'nenhum runner conectado a este projeto',
        );
      },
    });

    await expect(
      useCase.execute('proj-1', 'sess-1', makeAction()),
    ).resolves.toBeDefined();
    expect(gravados.at(-1)?.status).toBe('failed');
    expect(
      (gravados.at(-1)?.executionResult as { motivo: string }).motivo,
    ).toContain('nenhum runner conectado');
  });

  it('RunnerRecusouContainerError vira failed, nunca propaga', async () => {
    const { useCase, gravados } = build({
      executionMode: 'mounted',
      startContainerViaRunner: async () => {
        throw new RunnerRecusouContainerError('Docker indisponível na máquina do usuário');
      },
    });

    await expect(
      useCase.execute('proj-1', 'sess-1', makeAction()),
    ).resolves.toBeDefined();
    expect(gravados.at(-1)?.status).toBe('failed');
  });
});
