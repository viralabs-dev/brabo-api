import { describe, it, expect } from 'vitest';
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
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { UpsertAgentInstructionUseCase } from '../../../../src/application/use-cases/agents/upsert-agent-instruction.use-case';

const MODULOS = [
  { name: 'api', stack: 'NestJS', responsibility: 'regras', dependsOn: [] },
  { name: 'web', stack: 'React', responsibility: 'ui', dependsOn: ['api'] },
];

function build(opts?: {
  projectBudget?: number | null;
  projectBreaker?: number | null;
  modules?: typeof MODULOS;
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

  const sessions = {
    create: () => Promise.resolve({ id: 'sess-1' }),
  } as unknown as SessionRepository;

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

  const permissionsFile = {
    addPattern: (_p: string, _list: string, pattern: string) => {
      allowPatterns.push(pattern);
      return Promise.resolve();
    },
  } as unknown as PermissionsFileStore;

  const transitionSession = {
    execute: () => Promise.resolve({}),
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

  return {
    useCase: new ActivateExecutionUseCase(
      moduleMaps,
      sessions,
      taskRepo,
      agentAutonomy,
      engineClient,
      transitionSession,
      appendEvent,
      upsertInstruction,
      projects,
      permissionsFile,
    ),
    started,
    autonomias,
    allowPatterns,
    projectUpdates,
    eventos,
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
