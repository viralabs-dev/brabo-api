import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ExecuteContainerStartUseCase } from '../../../../src/application/use-cases/actions/execute-container-start.use-case';
import {
  BrokerIndisponivelError,
  BrokerRecusouError,
} from '../../../../src/application/ports/container-broker.port';
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
  workspacePath?: string | null;
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
          resources: (input as { resources: typeof RECURSOS_PADRAO }).resources,
        },
        version: 2,
      };
    }),
  };

  // `SubirCicloDeVidaDoContainerUseCase` foi EXTRAÍDO (RN-508, ADR 0145) pra
  // ser compartilhado com `ExecuteContainerStartViaRunnerUseCase` — o fake
  // aqui reproduz a MESMA dança que o `registrarTransicao` isolado provava
  // antes da extração, só que atrás do novo caso de uso.
  const registrarTransicao = vi.fn(async (to: string, input?: unknown) => {
    transicoes.push({ to, input });
  });

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

  const updatesDoProjeto: Array<Record<string, unknown>> = [];
  const projects = {
    findById: async () => ({
      id: 'proj-1',
      executionMode: opts.executionMode ?? 'container',
      workspaceDirName: 'proj-1-abc12345',
      workspacePath: opts.workspacePath ?? null,
      slug: 'proj-1',
      workspaceId: 'ws-1',
    }),
    update: vi.fn(async (_id: string, input: Record<string, unknown>) => {
      updatesDoProjeto.push(input);
      return null;
    }),
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
    subirCicloDeVida as never,
    broker,
    projects as never,
  );

  return {
    useCase,
    gravados,
    transicoes,
    decidirImagemChamadas,
    decidirImagem,
    broker,
    updatesDoProjeto,
  };
}

/**
 * A base da instalação (ADR 0141) e a pasta de um projeto `mounted` DENTRO
 * dela — devolvida sem existir, porque quem a cria é o caso de uso (RN-501).
 */
const basesTemporarias: string[] = [];
function baseComProjetoMontado(nome = 'loja'): { base: string; dir: string } {
  const base = mkdtempSync(join(tmpdir(), 'brabo-base-container-start-'));
  basesTemporarias.push(base);
  process.env.BRABO_PROJECTS_BASE = base;
  return { base, dir: join(base, nome) };
}

const baseOriginal = process.env.BRABO_PROJECTS_BASE;
afterEach(() => {
  if (baseOriginal === undefined) delete process.env.BRABO_PROJECTS_BASE;
  else process.env.BRABO_PROJECTS_BASE = baseOriginal;
  for (const base of basesTemporarias.splice(0)) {
    rmSync(base, { recursive: true, force: true });
  }
});

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

describe('ExecuteContainerStartUseCase — mounted vai pelo BROKER (RN-503)', () => {
  it('projeto "mounted": elege a candidata e sobe pelo broker', async () => {
    // A eleição não é opcional aqui, e por isso o teste a exige: o broker
    // COMPÕE a partir de `artifact.project_image`, indo buscá-lo na api. Uma
    // eleição que não fosse gravada nesse artefato seria inerte — o container
    // subiria com a imagem do Arquiteto e o payload aprovado diria outra.
    //
    // A pasta vem da base da instalação porque `mounted` MATERIALIZA antes de
    // qualquer transição (RN-501): sem base montada, o desfecho seria a falha
    // da materialização e este teste não chegaria a provar o destino.
    const { dir } = baseComProjetoMontado();
    const { useCase, gravados, transicoes, decidirImagem } = build({
      executionMode: 'mounted',
      workspacePath: dir,
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
  });

  it('"mounted" sem broker de pé vira `failed` NOMEADO, nunca throw', async () => {
    // O broker sobe sob `profiles: ["container-broker"]` e NÃO sobe por
    // padrão. A ausência dele é o caminho comum, não a exceção — e ela tem de
    // terminar num desfecho legível, com a origem no motivo.
    const { dir } = baseComProjetoMontado();
    const { useCase, gravados, transicoes } = build({
      executionMode: 'mounted',
      workspacePath: dir,
      cicloAtual: null,
      brokerStart: async () => {
        throw new BrokerIndisponivelError(
          'nao-configurado',
          'BROKER_URL não está definida — o broker sobe sob profile e não sobe por padrão',
        );
      },
    });

    await expect(
      useCase.execute('proj-1', 'sess-1', makeAction()),
    ).resolves.toBeDefined();
    expect(gravados.at(-1)?.status).toBe('failed');
    expect(
      (gravados.at(-1)?.executionResult as { motivo: string }).motivo,
    ).toContain('BROKER_URL');
    // Nada transicionou: não se registra o que não aconteceu.
    expect(transicoes).toEqual([]);
  });

  it('"mounted" com o broker recusando (BrokerRecusouError) também vira failed', async () => {
    const { dir } = baseComProjetoMontado();
    const { useCase, gravados } = build({
      executionMode: 'mounted',
      workspacePath: dir,
      brokerStart: async () => {
        throw new BrokerRecusouError(
          503,
          'BRABO_PROJECTS_HOST_BASE não está definida neste broker',
          'infra',
        );
      },
    });

    await expect(
      useCase.execute('proj-1', 'sess-1', makeAction()),
    ).resolves.toBeDefined();
    expect(gravados.at(-1)?.status).toBe('failed');
    expect(
      (gravados.at(-1)?.executionResult as { motivo: string }).motivo,
    ).toContain('BRABO_PROJECTS_HOST_BASE');
  });
});

/**
 * A MATERIALIZAÇÃO da pasta montada (ADR 0142, RN-501).
 *
 * A criação do projeto `mounted` deixou de exigir a pasta pronta — o requisito
 * é que o bind-mount nasça DEPOIS da decisão do Arquiteto. "Depois" é aqui,
 * quando a Infra sobe o container, e o que este bloco prova é o par que torna
 * isso honesto: a pasta é criada e `workspace_verified_at` é carimbado ANTES
 * de qualquer transição; a falha vira `failed` NOMEADO e o ciclo de vida NÃO
 * chega a ser marcado `provisioning`.
 */
describe('ExecuteContainerStartUseCase — materialização do `mounted` (RN-501)', () => {
  it('caminho feliz: CRIA a pasta, carimba workspace_verified_at e só então transiciona', async () => {
    const { dir } = baseComProjetoMontado();
    const { useCase, gravados, transicoes, updatesDoProjeto } = build({
      executionMode: 'mounted',
      workspacePath: dir,
      cicloAtual: null,
    });

    expect(existsSync(dir)).toBe(false);

    await useCase.execute('proj-1', 'sess-1', makeAction());

    expect(existsSync(dir)).toBe(true);
    expect(updatesDoProjeto).toHaveLength(1);
    expect(updatesDoProjeto[0].workspaceVerifiedAt).toBeInstanceOf(Date);
    expect(transicoes.map((t) => t.to)).toEqual(['provisioning', 'running']);
    expect(gravados.at(-1)?.status).toBe('executed');
  });

  it('pasta INALCANÇÁVEL vira failed NOMEADO, e NÃO transiciona para provisioning', async () => {
    const { base } = baseComProjetoMontado();
    // Fora da base: é a recusa que acontece antes de qualquer `mkdir`, e é a
    // que a mensagem precisa saber explicar.
    const { useCase, gravados, transicoes, updatesDoProjeto } = build({
      executionMode: 'mounted',
      workspacePath: '/home/voce/fora-da-base/loja',
      cicloAtual: null,
    });

    await expect(
      useCase.execute('proj-1', 'sess-1', makeAction()),
    ).resolves.toBeDefined();

    expect(transicoes).toEqual([]);
    expect(updatesDoProjeto).toEqual([]);
    expect(gravados.at(-1)?.status).toBe('failed');
    const motivo = (gravados.at(-1)?.executionResult as { motivo: string })
      .motivo;
    expect(motivo).toContain('/home/voce/fora-da-base/loja');
    expect(motivo).toContain(`BRABO_PROJECTS_BASE=${base}`);
    expect(motivo).toContain('non-root');
    expect(motivo).toContain('aprove container_start de novo');
  });

  it('linha `mounted` sem workspacePath: failed nomeado, sem criar pasta nem transicionar', async () => {
    baseComProjetoMontado();
    const { useCase, gravados, transicoes } = build({
      executionMode: 'mounted',
      workspacePath: null,
      cicloAtual: null,
    });

    await useCase.execute('proj-1', 'sess-1', makeAction());

    expect(transicoes).toEqual([]);
    expect(gravados.at(-1)?.status).toBe('failed');
    expect(
      (gravados.at(-1)?.executionResult as { motivo: string }).motivo,
    ).toContain('sem workspacePath');
  });

  it('projeto `container` não passa pela materialização — nada de mkdir nem de carimbo', async () => {
    const { useCase, updatesDoProjeto, transicoes } = build({
      executionMode: 'container',
      cicloAtual: null,
    });

    await useCase.execute('proj-1', 'sess-1', makeAction());

    expect(updatesDoProjeto).toEqual([]);
    expect(transicoes.map((t) => t.to)).toEqual(['provisioning', 'running']);
  });
});
