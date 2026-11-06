import { describe, it, expect } from 'vitest';
import { ProporRecriacaoDoAppUseCase } from '../../../../src/application/use-cases/actions/propor-recriacao-do-app.use-case';

const PR = 'pr-2';
const PR_URL = 'https://git/x/pull/2';

function acao(over: Record<string, unknown>) {
  return { id: 'a', status: 'executed', payload: {}, ...over };
}

const MERGE = {
  id: 'a',
  status: 'executed',
  payload: {},
  actionType: 'git_merge',
  executionResult: {
    kind: 'git_merge',
    pullRequestId: PR,
    state: 'merged',
    targetBranch: 'main',
  },
};

function build(
  opts: {
    infra?: unknown[];
    recreates?: unknown[];
    vigente?: unknown;
    ciclo?: unknown;
    mode?: string;
    redes?: unknown[];
  } = {},
) {
  const propostas: { input: Record<string, unknown> }[] = [];
  const infraOk = acao({
    actionType: 'open_infra_pr',
    payload: { run: { app: { command: 'node .', port: 3000 } } },
    executionResult: { pullRequestId: PR, pullRequestUrl: PR_URL },
  });
  const uc = new ProporRecriacaoDoAppUseCase(
    {
      listByProjectAndType: (_p: string, t: string) =>
        Promise.resolve(
          t === 'open_infra_pr'
            ? (opts.infra ?? [infraOk])
            : (opts.recreates ?? []),
        ),
    } as never,
    {
      findById: () =>
        Promise.resolve({ id: 'p', executionMode: opts.mode ?? 'container' }),
    } as never,
    { listByType: () => Promise.resolve(opts.redes ?? []) } as never,
    {
      execute: () =>
        Promise.resolve(
          opts.ciclo === undefined
            ? {
                status: 'running',
                statusChangedAt: new Date('2026-11-06T01:20:38Z'),
              }
            : opts.ciclo,
        ),
    } as never,
    {
      execute: () =>
        Promise.resolve(
          opts.vigente === undefined
            ? {
                app: { command: 'node .', port: 3000 },
                prUrl: PR_URL,
                declaredAt: '2026-11-06T01:22:10.000Z',
              }
            : opts.vigente,
        ),
    } as never,
    {
      execute: (_p: string, _s: string, input: Record<string, unknown>) => {
        propostas.push({ input });
        return Promise.resolve({ id: 'novo', status: 'pending' });
      },
    } as never,
  );
  return { uc, propostas, infraOk };
}

const rodar = (uc: ProporRecriacaoDoAppUseCase, merge: unknown = MERGE) =>
  uc.execute('p', 's', merge as never);

describe('ProporRecriacaoDoAppUseCase (AT-758, RN-1029)', () => {
  it('propõe o container_recreate da Infra com a porta 13000', async () => {
    const { uc, propostas } = build();
    await rodar(uc);
    expect(propostas).toHaveLength(1);
    expect(propostas[0].input).toEqual({
      actionType: 'container_recreate',
      actor: { kind: 'agent', id: 'infra' },
      payload: {
        reason: 'app_declared',
        pullRequestId: PR,
        ports: [{ host: 13000, container: 3000, protocol: 'tcp' }],
      },
    });
  });

  it('pula as portas já declaradas por outros projetos', async () => {
    const { uc, propostas } = build({
      redes: [
        { payload: { ports: [{ host: 13000 }, { host: 13001 }] } },
        { payload: { ports: [{ host: 13002 }] } },
      ],
    });
    await rodar(uc);
    expect(
      (propostas[0].input.payload as { ports: { host: number }[] }).ports[0]
        .host,
    ).toBe(13003);
  });

  it('merge de PR que NÃO é a de infra com run.app não propõe', async () => {
    const { uc, propostas } = build();
    await rodar(uc, {
      ...MERGE,
      executionResult: { ...MERGE.executionResult, pullRequestId: 'pr-9' },
    });
    expect(propostas).toHaveLength(0);
  });

  it('PR de infra sem run.app não propõe', async () => {
    const { infraOk } = build();
    const { uc, propostas } = build({
      infra: [{ ...infraOk, payload: { run: {} } }],
    });
    await rodar(uc);
    expect(propostas).toHaveLength(0);
  });

  it('merge que não foi para a main, ou não mergeou, não propõe', async () => {
    const { uc, propostas } = build();
    await rodar(uc, {
      ...MERGE,
      executionResult: { ...MERGE.executionResult, targetBranch: 'dev' },
    });
    await rodar(uc, {
      ...MERGE,
      executionResult: { ...MERGE.executionResult, state: 'open' },
    });
    expect(propostas).toHaveLength(0);
  });

  it('o vigente de OUTRA PR (mais nova) não propõe', async () => {
    const { uc, propostas } = build({
      vigente: {
        app: { command: 'x', port: 3000 },
        prUrl: 'https://git/x/pull/3',
        declaredAt: '2026-11-06T01:22:10.000Z',
      },
    });
    await rodar(uc);
    expect(propostas).toHaveLength(0);
  });

  it('recreate pendente não propõe de novo; negado/executado não impede', async () => {
    const a = build({ recreates: [{ status: 'pending' }] });
    await rodar(a.uc);
    expect(a.propostas).toHaveLength(0);
    const b = build({ recreates: [{ status: 'denied' }] });
    await rodar(b.uc);
    expect(b.propostas).toHaveLength(1);
  });

  it('container que subiu depois do vigente, ou projeto runner, não propõe', async () => {
    const a = build({
      ciclo: {
        status: 'running',
        statusChangedAt: new Date('2026-11-06T01:30:00Z'),
      },
    });
    await rodar(a.uc);
    const b = build({ mode: 'runner' });
    await rodar(b.uc);
    const c = build({ ciclo: null });
    await rodar(c.uc);
    expect(a.propostas.length + b.propostas.length + c.propostas.length).toBe(
      0,
    );
  });
});
