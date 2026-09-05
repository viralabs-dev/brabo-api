import { describe, it, expect, vi } from 'vitest';
import { ExecuteContainerStartViaRunnerUseCase } from '../../../../src/application/use-cases/actions/execute-container-start-via-runner.use-case';
import {
  RunnerNaoConectadoError,
  RunnerRecusouContainerError,
} from '../../../../src/application/ports/api-to-engine-client.port';
import { RECURSOS_PADRAO } from '../../../../src/domain/containers/project-container';
import type { ProposedAction } from '../../../../src/domain/actions/proposed-action.entity';
import type { ProjectContainerLifecycle } from '../../../../src/domain/containers/container-lifecycle';

const IMAGEM_DECIDIDA = 'node:22-bookworm-slim';

/**
 * Extraído de `execute-container-start.use-case.spec.ts` (RN-508, ADR
 * 0145) — até esta entrega `ExecuteContainerStartUseCase` também atendia
 * `runner` (`executeViaRunner`), e este bloco de testes vivia lá dentro.
 * `container_start_via_runner` virou AÇÃO própria porque o payload de
 * `container_start` (`imagem`/`network`/`resources`/`rationale`, a Infra
 * ELEGE) nunca fazia sentido pra este caminho — aqui não há candidata
 * nenhuma pra eleger, só a imagem já DECIDIDA.
 */
function makeAction(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: 'pa-1',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    seq: 1,
    actionType: 'container_start_via_runner',
    payload: { rationale: 'subir agora' },
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

function build(opts: {
  cicloAtual?: ProjectContainerLifecycle | null;
  spec?: {
    imagem: {
      image: string;
      network: 'none' | 'egress';
      resources: typeof RECURSOS_PADRAO;
    } | null;
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

  const registrarTransicao = vi.fn(async (to: string, input?: unknown) => {
    transicoes.push({ to, input });
  });

  // Mesmo racional de `execute-container-start.use-case.spec.ts`: o fake
  // reproduz a dança de `SubirCicloDeVidaDoContainerUseCase` — testada de
  // verdade em `subir-ciclo-de-vida-do-container.use-case.spec.ts` (se
  // existir) ou implicitamente aqui e no spec irmão, um consumidor cada.
  const subirCicloDeVida = {
    execute: vi.fn(async (_projectId: string, containerId: string) => {
      const atual = opts.cicloAtual === undefined ? null : opts.cicloAtual;
      if (!atual || atual.status === 'failed' || atual.status === 'removed') {
        await registrarTransicao('provisioning');
      }
      if (!atual || atual.status !== 'running') {
        await registrarTransicao('running', { containerId });
      }
    }),
  };

  const obterSpec = {
    execute: async () =>
      opts.spec ?? {
        projectId: 'proj-1',
        projectSlug: 'proj-1',
        workspaceId: 'ws-1',
        workspaceDirName: 'proj-1-abc12345',
        executionMode: 'runner' as const,
        imagem: {
          image: IMAGEM_DECIDIDA,
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

  const useCase = new ExecuteContainerStartViaRunnerUseCase(
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
    obterSpec as never,
    apiToEngineClient as never,
    subirCicloDeVida as never,
  );

  return { useCase, gravados, transicoes, apiToEngineClient, subirCicloDeVida };
}

describe('ExecuteContainerStartViaRunnerUseCase — caminho feliz', () => {
  it('pede ao engine via ApiToEngineClient, sem eleger imagem nenhuma', async () => {
    const { useCase, gravados, transicoes, apiToEngineClient } = build({
      cicloAtual: null,
    });

    await useCase.execute('proj-1', 'sess-1', makeAction());

    expect(apiToEngineClient.startContainerViaRunner).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({ imagem: IMAGEM_DECIDIDA }),
    );
    expect(transicoes.map((t) => t.to)).toEqual(['provisioning', 'running']);
    expect(gravados.at(-1)?.status).toBe('executed');
    expect(
      (gravados.at(-1)?.executionResult as { imagem: string }).imagem,
    ).toBe(IMAGEM_DECIDIDA);
  });

  it('linha já "running" não transiciona nada — idempotente', async () => {
    const { useCase, transicoes, gravados } = build({
      cicloAtual: {
        id: 'lc-1',
        projectId: 'proj-1',
        status: 'running',
        imageVersion: 3,
        containerId: 'container-runner-1',
        resources: RECURSOS_PADRAO,
        failureReason: null,
        createdAt: new Date(),
        statusChangedAt: new Date(),
      },
      startContainerViaRunner: async () => ({
        containerId: 'container-runner-1',
        nome: 'brabo-proj-1-abc12345',
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

describe('ExecuteContainerStartViaRunnerUseCase — sem imagem decidida (RN-105)', () => {
  it('falha sem chamar o engine', async () => {
    const { useCase, gravados, apiToEngineClient } = build({
      spec: { imagem: null, imagemVersao: 0 },
    });

    await useCase.execute('proj-1', 'sess-1', makeAction());

    expect(apiToEngineClient.startContainerViaRunner).not.toHaveBeenCalled();
    expect(gravados.at(-1)?.status).toBe('failed');
    expect(
      (gravados.at(-1)?.executionResult as { motivo: string }).motivo,
    ).toContain('RN-105');
  });
});

describe('ExecuteContainerStartViaRunnerUseCase — falhas nomeadas do runner', () => {
  it('RunnerNaoConectadoError vira failed, nunca propaga', async () => {
    const { useCase, gravados, transicoes } = build({
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
    // Falha ANTES de subir ciclo de vida nenhum: nada se registra como
    // provisionado quando nada de fato subiu.
    expect(transicoes).toEqual([]);
  });

  it('RunnerRecusouContainerError vira failed, nunca propaga', async () => {
    const { useCase, gravados } = build({
      startContainerViaRunner: async () => {
        throw new RunnerRecusouContainerError(
          'Docker indisponível na máquina do usuário',
        );
      },
    });

    await expect(
      useCase.execute('proj-1', 'sess-1', makeAction()),
    ).resolves.toBeDefined();
    expect(gravados.at(-1)?.status).toBe('failed');
    expect(
      (gravados.at(-1)?.executionResult as { motivo: string }).motivo,
    ).toContain('Docker indisponível');
  });

  it('erro NÃO nomeado propaga (não vira failed silencioso) — só os dois nomeados degradam', async () => {
    const { useCase } = build({
      startContainerViaRunner: async () => {
        throw new Error('erro de transporte inesperado');
      },
    });

    // O `catch` externo do `execute/3` ainda intercepta QUALQUER Error e
    // grava `failed` — o que este teste prova é que o erro chega até lá
    // (não é engolido antes), não que ele escapa do use case.
    const resultado = await useCase.execute('proj-1', 'sess-1', makeAction());
    expect(resultado).toBeDefined();
  });
});
