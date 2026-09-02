import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { ActivateExecutionUseCase } from '../../../../src/application/use-cases/execution/activate-execution.use-case';
import { DEV_TERMINAL_ALLOW_PATTERNS } from '../../../../src/domain/actions/dev-terminal-patterns';
import type { ModuleMapRepository } from '../../../../src/application/ports/module-map-repository.port';
import type { SessionRepository } from '../../../../src/application/ports/session-repository.port';
import type { TaskRepository } from '../../../../src/application/ports/backlog-repository.port';
import type { AgentAutonomyRepository } from '../../../../src/application/ports/agent-autonomy-repository.port';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import type { ProjectRepository } from '../../../../src/application/ports/project-repository.port';
import type { PermissionsFileStore } from '../../../../src/application/ports/permissions-file-store.port';
import type { TransitionSessionUseCase } from '../../../../src/application/use-cases/sessions/transition-session.use-case';
import { CreateSessionUseCase } from '../../../../src/application/use-cases/sessions/create-session.use-case';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { GetSessionPendingWorkUseCase } from '../../../../src/application/use-cases/sessions/get-session-pending-work.use-case';
import type { UpsertAgentInstructionUseCase } from '../../../../src/application/use-cases/agents/upsert-agent-instruction.use-case';
import { SeedAgentAreasUseCase } from '../../../../src/application/use-cases/agents/seed-agent-areas.use-case';
import type {
  AgentAreaRepository,
  UpsertAreaInput,
} from '../../../../src/application/ports/agent-area-repository.port';
import type { ProjectWorkspaceLocation } from '../../../../src/domain/iam/project.entity';
import { FsPermissionsFileStore } from '../../../../src/infrastructure/filesystem/fs-permissions-file-store';

const MODULOS = [
  { name: 'api', stack: 'NestJS', responsibility: 'regras', dependsOn: [] },
  { name: 'web', stack: 'React', responsibility: 'ui', dependsOn: ['api'] },
];

function build(opts?: {
  projectBudget?: number | null;
  projectBreaker?: number | null;
  modules?: typeof MODULOS;
  /** Sessão de execução já vigente no projeto (cenário de REATIVAÇÃO). */
  sessaoVigente?: { id: string } | null;
  /** Sessão de origem (chat de onde partiu "ativar execução") — RN-135. */
  sessaoOrigem?: { id: string; status: string } | null;
  /** O que `GetSessionPendingWorkUseCase` devolve para a sessão de origem. */
  pendingWork?: { pending: boolean; motivo: string | null };
  /**
   * A LOCALIZAÇÃO do workspace do projeto (RN-169/RN-478) — o par
   * (modo, caminho) + o nome de pasta congelado. O default é o modo de
   * sempre; os casos de `runner` e de linha incoerente sobrescrevem.
   */
  local?: Partial<ProjectWorkspaceLocation>;
  /**
   * Store de permissões alternativo — os casos da RN-478 passam o
   * `FsPermissionsFileStore` DE VERDADE, porque o que eles provam é
   * justamente ONDE o arquivo cai no disco.
   */
  permissionsStore?: PermissionsFileStore;
}) {
  const started: {
    budget?: number;
    maxCorrections?: number;
    impl?: string;
    maxConsecutiveBlocked?: number;
  } = {};
  const autonomias: { agentId: string; type: string }[] = [];
  const allowPatterns: string[] = [];
  const projectUpdates: Record<string, unknown>[] = [];
  const eventos: { type: string; payload: Record<string, unknown> }[] = [];

  const moduleMaps = {
    findCurrent: () => Promise.resolve({ modules: opts?.modules ?? MODULOS }),
  } as unknown as ModuleMapRepository;

  const sessoesCriadas: string[] = [];
  const sessoesAtivadas: string[] = [];
  const transicoes: { sessionId: string; to: string }[] = [];

  // `create` fica aqui para EXPLODIR se alguém voltar a criar sessão pelo
  // repositório: o caminho é o `CreateSessionUseCase`, que é quem emite
  // `session.created` no outbox (RN-067).
  const sessions = {
    create: () => {
      throw new Error(
        'sessão criada pelo repositório: use o CreateSessionUseCase (RN-067)',
      );
    },
    findActiveExecutionSession: () =>
      Promise.resolve(opts?.sessaoVigente ?? null),
    findInProject: (_p: string, sessionId: string) => {
      if (opts?.sessaoOrigem?.id === sessionId) {
        return Promise.resolve(opts.sessaoOrigem);
      }
      return Promise.resolve(null);
    },
  } as unknown as SessionRepository;

  const getSessionPendingWork = {
    execute: () =>
      Promise.resolve(
        opts?.pendingWork ?? { pending: false, motivo: null },
      ),
  } as unknown as GetSessionPendingWorkUseCase;

  const createSession = {
    execute: () => {
      sessoesCriadas.push('sess-1');
      return Promise.resolve({ id: 'sess-1' });
    },
  } as unknown as CreateSessionUseCase;

  const taskRepo = {
    countClaimableByModule: () => Promise.resolve(0),
  } as unknown as TaskRepository;

  const agentAutonomy = {
    upsert: (_p: string, agentId: string, type: string) => {
      autonomias.push({ agentId, type });
      return Promise.resolve();
    },
  } as unknown as AgentAutonomyRepository;

  const engineClient = {
    startExecution: (
      _p: string,
      _s: string,
      _m: string[],
      budget?: number,
      maxCorrections?: number,
      impl?: string,
      maxConsecutiveBlocked?: number,
    ) => {
      started.budget = budget;
      started.maxCorrections = maxCorrections;
      started.impl = impl;
      started.maxConsecutiveBlocked = maxConsecutiveBlocked;
      return Promise.resolve();
    },
  } as unknown as ApiToEngineClient;

  const projects = {
    findById: () =>
      Promise.resolve({
        id: 'proj-1',
        workspaceDirName: 'proj-1',
        executionMode: 'container',
        workspacePath: null,
        ...opts?.local,
        taskBudgetMicros:
          opts?.projectBudget === undefined ? null : opts.projectBudget,
        maxConsecutiveBlocked:
          opts?.projectBreaker === undefined ? null : opts.projectBreaker,
      }),
    update: (_id: string, input: Record<string, unknown>) => {
      projectUpdates.push(input);
      return Promise.resolve(null);
    },
  } as unknown as ProjectRepository;

  const permissionsFile =
    opts?.permissionsStore ??
    ({
      addPattern: (_p: string, _list: string, pattern: string) => {
        allowPatterns.push(pattern);
        return Promise.resolve();
      },
    } as unknown as PermissionsFileStore);

  const transitionSession = {
    execute: (_p: string, sessionId: string, to: string) => {
      transicoes.push({ sessionId, to });
      if (to === 'active') sessoesAtivadas.push(sessionId);
      return Promise.resolve({});
    },
  } as unknown as TransitionSessionUseCase;

  const appendEvent = {
    execute: (
      _p: string,
      _s: string,
      e: { type: string; payload: Record<string, unknown> },
    ) => {
      eventos.push(e);
      return Promise.resolve({});
    },
  } as unknown as AppendSessionEventUseCase;

  const upsertInstruction = {
    execute: () => Promise.resolve({}),
  } as unknown as UpsertAgentInstructionUseCase;

  // Áreas semeadas de verdade pelo caso de uso real (RN-094) — o fake é só o
  // repositório. Trocar o `SeedAgentAreasUseCase` por um fake aqui esconderia
  // exatamente o defeito da FASE 18: o caminho até o `upsert`.
  const areasSemeadas: UpsertAreaInput[] = [];
  const seedAreas = new SeedAgentAreasUseCase({
    upsert: (input: UpsertAreaInput) => {
      areasSemeadas.push(input);
      return Promise.resolve({ id: 'area-1', maxParallel: 2, ...input });
    },
  } as unknown as AgentAreaRepository);

  return {
    useCase: new ActivateExecutionUseCase(
      moduleMaps,
      sessions,
      taskRepo,
      agentAutonomy,
      engineClient,
      transitionSession,
      createSession,
      appendEvent,
      upsertInstruction,
      projects,
      permissionsFile,
      seedAreas,
      getSessionPendingWork,
    ),
    areasSemeadas,
    started,
    autonomias,
    allowPatterns,
    projectUpdates,
    eventos,
    sessoesCriadas,
    sessoesAtivadas,
    transicoes,
  };
}

describe('ActivateExecutionUseCase — orçamento por task', () => {
  it('sem parâmetro e sem setting do projeto: usa o default', async () => {
    const { useCase, started } = build();

    await useCase.execute('proj-1', 'user-1');

    expect(started.budget).toBe(500_000);
  });

  it('setting do projeto vence o default', async () => {
    const { useCase, started } = build({ projectBudget: 1_200_000 });

    await useCase.execute('proj-1', 'user-1');

    expect(started.budget).toBe(1_200_000);
  });

  it('parâmetro vence o setting do projeto E é persistido (sobrevive à reativação)', async () => {
    // Antes o valor só existia em engine.dev_agent_states; reativar sem
    // repassá-lo voltava silenciosamente pro default.
    const { useCase, started, projectUpdates } = build({
      projectBudget: 1_200_000,
    });

    await useCase.execute('proj-1', 'user-1', 300_000);

    expect(started.budget).toBe(300_000);
    expect(projectUpdates).toEqual([{ taskBudgetMicros: 300_000 }]);
  });

  it('parâmetro igual ao já persistido não gera escrita à toa', async () => {
    const { useCase, projectUpdates } = build({ projectBudget: 300_000 });

    await useCase.execute('proj-1', 'user-1', 300_000);

    expect(projectUpdates).toEqual([]);
  });

  it('o orçamento resolvido entra no evento de ativação', async () => {
    const { useCase, eventos } = build({ projectBudget: 777_000 });

    await useCase.execute('proj-1', 'user-1');

    const ativacao = eventos.find((e) => e.type === 'execution.activated');
    expect(ativacao?.payload.taskBudgetMicros).toBe(777_000);
  });
});

// Achado #11 do primeiro dogfooding. O `sessions.create` era incondicional:
// cada clique em "ativar" abria uma sessão nova, ativa, que recebia o
// `execution.activated` e mais nada — porque o engine descarta o `session_id`
// quando o agente já está vivo, e os eventos dos agentes continuavam indo pra
// sessão da ativação anterior.
describe('ActivateExecutionUseCase — reativação não abre sessão órfã', () => {
  it('sem sessão de execução vigente: cria e ativa uma', async () => {
    const { useCase, sessoesCriadas, sessoesAtivadas } = build();

    const { sessionId } = await useCase.execute('proj-1', 'user-1');

    expect(sessionId).toBe('sess-1');
    expect(sessoesCriadas).toEqual(['sess-1']);
    expect(sessoesAtivadas).toEqual(['sess-1']);
  });

  it('com sessão vigente: reusa, sem criar nem re-transicionar', async () => {
    const { useCase, sessoesCriadas, sessoesAtivadas } = build({
      sessaoVigente: { id: 'sess-em-curso' },
    });

    const { sessionId } = await useCase.execute('proj-1', 'user-1');

    expect(sessionId).toBe('sess-em-curso');
    expect(sessoesCriadas).toEqual([]);
    // Transicionar uma sessão que já está `active` para `active` seria um
    // no-op na melhor das hipóteses e um erro de máquina de estados na pior.
    expect(sessoesAtivadas).toEqual([]);
  });

  it('o evento de ativação da reativação cai na sessão vigente', async () => {
    const { useCase, eventos } = build({
      sessaoVigente: { id: 'sess-em-curso' },
    });

    await useCase.execute('proj-1', 'user-1');

    // O `execution.activated` continua sendo emitido — reativar É um fato do
    // projeto —, mas na linha do tempo que os agentes já estão escrevendo.
    expect(eventos.some((e) => e.type === 'execution.activated')).toBe(true);
  });
});

describe('ActivateExecutionUseCase — circuit breaker (Fase 12b — RN-047)', () => {
  it('sem parâmetro e sem setting do projeto: usa o default', async () => {
    const { useCase, started } = build();

    await useCase.execute('proj-1', 'user-1');

    expect(started.maxConsecutiveBlocked).toBe(3);
  });

  it('setting do projeto vence o default', async () => {
    const { useCase, started } = build({ projectBreaker: 5 });

    await useCase.execute('proj-1', 'user-1');

    expect(started.maxConsecutiveBlocked).toBe(5);
  });

  it('parâmetro vence o setting do projeto E é persistido (sobrevive à reativação)', async () => {
    const { useCase, started, projectUpdates } = build({
      projectBreaker: 5,
    });

    await useCase.execute(
      'proj-1',
      'user-1',
      undefined,
      undefined,
      undefined,
      undefined,
      2,
    );

    expect(started.maxConsecutiveBlocked).toBe(2);
    expect(projectUpdates).toEqual([{ maxConsecutiveBlocked: 2 }]);
  });

  it('parâmetro igual ao já persistido não gera escrita à toa', async () => {
    const { useCase, projectUpdates } = build({ projectBreaker: 2 });

    await useCase.execute(
      'proj-1',
      'user-1',
      undefined,
      undefined,
      undefined,
      undefined,
      2,
    );

    expect(projectUpdates).toEqual([]);
  });

  it('orçamento E breaker divergindo juntos: uma escrita só, com os dois campos', async () => {
    const { useCase, projectUpdates } = build({
      projectBudget: 1_200_000,
      projectBreaker: 5,
    });

    await useCase.execute(
      'proj-1',
      'user-1',
      300_000,
      undefined,
      undefined,
      undefined,
      2,
    );

    expect(projectUpdates).toEqual([
      { taskBudgetMicros: 300_000, maxConsecutiveBlocked: 2 },
    ]);
  });
});

describe('ActivateExecutionUseCase — terminal do dev', () => {
  it('seeda os padrões estreitos de terminal no permissions.json', async () => {
    // Sem isto o `terminal` do dev nasce pendente, ele nunca vê exit 0, e o
    // ReportDone jamais deixa abrir PR — a task sempre acaba bloqueada.
    const { useCase, allowPatterns } = build();

    await useCase.execute('proj-1', 'user-1');

    expect(allowPatterns).toEqual([...DEV_TERMINAL_ALLOW_PATTERNS]);
    expect(allowPatterns).toContain('Terminal(pnpm test)');
  });

  it('override explícito substitui a lista default', async () => {
    const { useCase, allowPatterns } = build();

    await useCase.execute('proj-1', 'user-1', undefined, undefined, undefined, [
      'Terminal(make test)',
    ]);

    expect(allowPatterns).toEqual(['Terminal(make test)']);
  });

  it('NÃO seeda autonomia pra terminal — quem libera é o arquivo, pra deny vencer', async () => {
    const { useCase, autonomias } = build();

    await useCase.execute('proj-1', 'user-1');

    expect(autonomias.map((a) => a.type)).not.toContain('terminal');
  });

  it('NUNCA seeda autonomia pra git_merge (trava de merge)', async () => {
    const { useCase, autonomias } = build();

    await useCase.execute('proj-1', 'user-1');

    expect(autonomias.map((a) => a.type)).not.toContain('git_merge');
    expect(new Set(autonomias.map((a) => a.type))).toEqual(
      new Set(['git_commit', 'git_push', 'pr_open']),
    );
  });

  it('seeda autonomia pra cada dev do module_map', async () => {
    const { useCase, autonomias } = build();

    await useCase.execute('proj-1', 'user-1');

    expect(new Set(autonomias.map((a) => a.agentId))).toEqual(
      new Set(['dev-api', 'dev-web']),
    );
  });
});

describe('ActivateExecutionUseCase — áreas de agente (RN-094)', () => {
  it('a ativação semeia as três áreas, e a de dev com um membro por módulo', async () => {
    // O que a ativação acrescenta ao que a criação do projeto já gravou são os
    // MEMBROS da área dinâmica: `dev-<modulo>` sai do `module_map`, que não
    // existia quando o projeto nasceu.
    const { useCase, areasSemeadas } = build();

    await useCase.execute('proj-1', 'user-1');

    expect(areasSemeadas.map((a) => a.key)).toEqual(['dev', 'qa', 'infra']);
    expect(areasSemeadas.find((a) => a.key === 'dev')?.members).toEqual([
      'dev-api',
      'dev-web',
    ]);
    expect(areasSemeadas.find((a) => a.key === 'qa')?.members).toEqual([
      'qa-automacao',
      'qa-performance-seguranca',
    ]);
  });

  it('NUNCA manda `maxParallel` — semear de novo não desfaz a decisão do usuário', async () => {
    // O teto é do usuário (FASE 14d). Como a ativação é repetível, mandar o
    // default aqui faria um teto subido para 5 voltar para 2 em silêncio.
    const { useCase, areasSemeadas } = build();

    await useCase.execute('proj-1', 'user-1');

    expect(areasSemeadas.every((a) => a.maxParallel === undefined)).toBe(true);
  });
});

// RN-135: a sessão de CHAT (criativa/consultiva) de onde partiu o clique em
// "ativar execução" nunca era fechada — ficava `active` para sempre, mesmo
// com a execução já avançando sozinha numa sessão separada.
describe('ActivateExecutionUseCase — fecha a sessão de origem (RN-135)', () => {
  it('sessão de origem informada e SEM pendência: fecha (closing -> closed)', async () => {
    const { useCase, transicoes } = build({
      sessaoOrigem: { id: 'sess-origem', status: 'active' },
      pendingWork: { pending: false, motivo: null },
    });

    await useCase.execute(
      'proj-1',
      'user-1',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'sess-origem',
    );

    expect(
      transicoes.filter((t) => t.sessionId === 'sess-origem').map((t) => t.to),
    ).toEqual(['closing', 'closed']);
  });

  it('sessão de origem informada e COM pendência: NÃO fecha', async () => {
    const { useCase, transicoes } = build({
      sessaoOrigem: { id: 'sess-origem', status: 'active' },
      pendingWork: {
        pending: true,
        motivo: 'handoff po → arquiteto aguardando aceite',
      },
    });

    await useCase.execute(
      'proj-1',
      'user-1',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'sess-origem',
    );

    expect(transicoes.filter((t) => t.sessionId === 'sess-origem')).toEqual(
      [],
    );
  });

  it('sessão de origem já não está active: não tenta transicionar', async () => {
    const { useCase, transicoes } = build({
      sessaoOrigem: { id: 'sess-origem', status: 'closed' },
    });

    await useCase.execute(
      'proj-1',
      'user-1',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'sess-origem',
    );

    expect(transicoes.filter((t) => t.sessionId === 'sess-origem')).toEqual(
      [],
    );
  });

  it('sem `originSessionId` (chamador antigo, ex. Visão Geral): nada é fechado', async () => {
    const { useCase, transicoes } = build({
      sessaoOrigem: { id: 'sess-origem', status: 'active' },
    });

    await useCase.execute('proj-1', 'user-1');

    // A ÚNICA transição é a ativação da sessão de execução nova — a de
    // origem, sem o parâmetro, nunca é sequer consultada.
    expect(transicoes).toEqual([{ sessionId: 'sess-1', to: 'active' }]);
  });

  it('originSessionId igual à sessão de execução: nunca fecha a própria execução', async () => {
    const { useCase, transicoes } = build({
      sessaoVigente: { id: 'sess-em-curso' },
      sessaoOrigem: { id: 'sess-em-curso', status: 'active' },
    });

    await useCase.execute(
      'proj-1',
      'user-1',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'sess-em-curso',
    );

    expect(transicoes).toEqual([]);
  });
});

/**
 * RN-478 — a ativação é a PRIMEIRA escrita do `permissions.json`, e era ela
 * que devolvia 500 em projeto no modo `runner`.
 *
 * Estes dois casos usam o `FsPermissionsFileStore` DE VERDADE (com uma raiz
 * gerenciada temporária), e não o dublê dos casos acima: o que eles provam é
 * exatamente ONDE o arquivo cai no disco — um fake que só coleciona padrões
 * não enxergaria a diferença, que foi como isto atravessou.
 */
describe('ActivateExecutionUseCase — permissions.json em projeto `runner` (RN-478)', () => {
  const raizesTemporarias: string[] = [];

  afterEach(() => {
    delete process.env.PROJECT_WORKSPACES_ROOT;
    for (const raiz of raizesTemporarias.splice(0)) {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  function raizGerenciadaTemporaria(): string {
    const raiz = mkdtempSync(join(tmpdir(), 'brabo-rn478-'));
    raizesTemporarias.push(raiz);
    process.env.PROJECT_WORKSPACES_ROOT = raiz;
    return raiz;
  }

  it('escreve na raiz GERENCIADA, e nunca na pasta do host que só o runner enxerga', async () => {
    const raiz = raizGerenciadaTemporaria();
    // Um caminho do host que NÃO existe dentro do container da api — é o caso
    // real: `/home/danielsouza/dev/exp002`. Antes, o `mkdir -p` dele daqui
    // dentro morria com `EACCES: permission denied, mkdir '/home'`.
    const pastaDoHost = '/home/voce/dev/exp002';

    const { useCase } = build({
      permissionsStore: new FsPermissionsFileStore(),
      local: {
        workspaceDirName: 'exp002-f52be111',
        executionMode: 'runner',
        workspacePath: pastaDoHost,
      },
    });

    await useCase.execute('proj-1', 'user-1');

    const arquivo = join(raiz, 'exp002-f52be111', 'permissions.json');
    expect(existsSync(arquivo)).toBe(true);
    expect(
      (JSON.parse(readFileSync(arquivo, 'utf-8')) as { allow: string[] }).allow,
    ).toEqual([...DEV_TERMINAL_ALLOW_PATTERNS]);
    // A pasta do host continua intocada: a api não tem o que fazer nela.
    expect(existsSync(pastaDoHost)).toBe(false);
  });

  it('projeto `mounted` continua com o arquivo ao lado do código — a correção não mudou o modo que É bind-mount', async () => {
    raizGerenciadaTemporaria();
    const pastaMontada = mkdtempSync(join(tmpdir(), 'brabo-mount-'));
    raizesTemporarias.push(pastaMontada);

    const { useCase } = build({
      permissionsStore: new FsPermissionsFileStore(),
      local: {
        workspaceDirName: 'loja-3f2b1c8e',
        executionMode: 'mounted',
        workspacePath: pastaMontada,
      },
    });

    await useCase.execute('proj-1', 'user-1');

    expect(existsSync(join(pastaMontada, 'permissions.json'))).toBe(true);
  });

  it('workspacePath corrompido no banco vira 400 que ENSINA, nunca 500 sem corpo', async () => {
    raizGerenciadaTemporaria();

    const { useCase } = build({
      permissionsStore: new FsPermissionsFileStore(),
      local: {
        // Só se chega a isto adulterando a coluna direto no banco: a criação
        // e a conversão aplicam a mesma régua léxica (RN-422/RN-423).
        //
        // `mounted` e não `runner` de propósito: é justamente no modo
        // `mounted` que o `permissions.json` ainda deriva do `workspacePath`
        // (RN-478). No modo `runner` ele passou a derivar do
        // `workspaceDirName`, e é o caso logo abaixo que cobre o outro
        // ponto de recusa.
        workspaceDirName: 'loja-3f2b1c8e',
        executionMode: 'mounted',
        workspacePath: '/home/voce/../../etc',
      },
    });

    await expect(useCase.execute('proj-1', 'user-1')).rejects.toMatchObject({
      status: 400,
    });
    await expect(useCase.execute('proj-1', 'user-1')).rejects.toThrow(
      /Configurações › Modo de execução/,
    );
  });

  it('workspaceDirName corrompido em projeto `runner` também é 400 — a raiz gerenciada tem o MESMO ponto de recusa de sempre', async () => {
    raizGerenciadaTemporaria();

    const { useCase } = build({
      permissionsStore: new FsPermissionsFileStore(),
      local: {
        workspaceDirName: '../../etc',
        executionMode: 'runner',
        workspacePath: '/home/voce/dev/exp002',
      },
    });

    await expect(useCase.execute('proj-1', 'user-1')).rejects.toMatchObject({
      status: 400,
    });
  });
});
