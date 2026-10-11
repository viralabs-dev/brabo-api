import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  projects,
  proposedActions,
  sessionEvents,
  sessions,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleSessionContextSummaryRepository } from '../../../../src/infrastructure/persistence/drizzle/session-context-summary.repository';

const { db, pool } = createTestDb();
const repo = new DrizzleSessionContextSummaryRepository(db);

let seq = 0;
let userId: string;
let projectId: string;

async function sessao() {
  const [row] = await db
    .insert(sessions)
    .values({ projectId, createdBy: userId })
    .returning();
  return row.id;
}

async function evento(
  sessionId: string,
  type: string,
  actorId: string,
  payload: Record<string, unknown> = {},
) {
  seq += 1;
  await db.insert(sessionEvents).values({
    id: `evt-${seq}`,
    sessionId,
    seq,
    type,
    actorKind: 'agent',
    actorId,
    payload,
  });
}

async function acao(
  sessionId: string,
  actionType: string,
  actorId: string,
  extra: {
    payload?: unknown;
    status?: 'executed';
    executionResult?: unknown;
  } = {},
) {
  await db.insert(proposedActions).values({
    projectId,
    sessionId,
    actionType,
    resolvedPolicy: 'require_approval',
    actorKind: 'agent',
    actorId,
    payload: extra.payload ?? {},
    status: extra.status ?? 'pending',
    executionResult: (extra.executionResult ?? null) as never,
  });
}

describe('DrizzleSessionContextSummaryRepository (RN-827/828)', () => {
  beforeEach(async () => {
    await truncateAll(db);
    seq = 0;
    const [u] = await db
      .insert(users)
      .values({ keycloakSub: 'sub-ctx', email: 'ctx@x', name: 'ctx' })
      .returning();
    userId = u.id;
    const [w] = await db
      .insert(workspaces)
      .values({ name: 'w', slug: 'w', createdBy: userId })
      .returning();
    const [p] = await db
      .insert(projects)
      .values({ workspaceId: w.id, name: 'p', slug: 'p', createdBy: userId })
      .returning();
    projectId = p.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('conta a sessão INTEIRA, além de qualquer cauda de 200, e soma os arquivos da execução ligada', async () => {
    const criativa = await sessao();
    const execucao = await sessao();
    // 250 eventos de ruído antes, para as regras ficarem fora de uma cauda.
    for (let i = 0; i < 11; i++)
      await evento(criativa, 'artifact.business_rule', 'po');
    for (let i = 0; i < 250; i++) await evento(criativa, 'agent.status', 'po');
    for (let i = 0; i < 6; i++)
      await evento(criativa, 'artifact.decision_record', 'criativo');
    await evento(criativa, 'backlog.epic_created', 'po');
    await evento(criativa, 'backlog.story_created', 'po');
    await acao(criativa, 'open_adr_pr', 'arquiteto');
    await acao(criativa, 'propose_execution_plan', 'dev-lead', {
      status: 'executed',
      executionResult: { sessaoDeExecucao: execucao },
    });
    await acao(execucao, 'git_commit', 'dev-api', {
      payload: { files: [{ path: 'src/a.ts', additions: 3, deletions: 1 }] },
    });

    const r = await repo.resumir(projectId, criativa);

    expect(r.sessoesLidas).toEqual([criativa, execucao]);
    expect(r.regras).toBe(11);
    expect(r.decisoes).toBe(6);
    expect(r.artefatosPorAgente).toEqual([
      { actorId: 'po', quantos: 2 },
      { actorId: 'arquiteto', quantos: 1 },
    ]);
    expect(r.arquivosTocados.total).toBe(1);
    expect(r.arquivosTocados.itens[0]).toMatchObject({
      path: 'src/a.ts',
      additions: 3,
      deletions: 1,
    });
  });

  it('corta a lista de arquivos no teto e devolve o total real; não lê sessão sem ligação', async () => {
    const s = await sessao();
    const outra = await sessao();
    const files = Array.from({ length: 120 }, (_, i) => ({
      path: `f${i}.ts`,
      additions: 1,
      deletions: 0,
    }));
    await acao(s, 'git_push', 'dev-api', { payload: { files } });
    await acao(outra, 'git_commit', 'dev-api', {
      payload: { files: [{ path: 'alheio.ts', additions: 1, deletions: 0 }] },
    });
    await evento(outra, 'artifact.business_rule', 'po');

    const r = await repo.resumir(projectId, s);

    expect(r.sessoesLidas).toEqual([s]);
    expect(r.regras).toBe(0);
    expect(r.arquivosTocados.total).toBe(120);
    expect(r.arquivosTocados.itens).toHaveLength(100);
    expect(r.arquivosTocados.itens.some((f) => f.path === 'alheio.ts')).toBe(
      false,
    );
  });

  it('RN-844: devolve os ITENS de regra e decisão fora de qualquer cauda, com teto de 50', async () => {
    const s = await sessao();
    for (let i = 0; i < 55; i++)
      await evento(s, 'artifact.business_rule', 'po', {
        title: `Regra ${i}`,
        description: 'd',
        origin: ['a', 'b'],
      });
    await evento(s, 'artifact.decision_record', 'criativo', {
      choice: 'SQLite',
      context: 'um módulo só',
    });
    for (let i = 0; i < 250; i++) await evento(s, 'agent.status', 'po');

    const r = await repo.resumir(projectId, s);

    expect(r.regras).toBe(55);
    expect(r.itensDeRegras).toHaveLength(50);
    expect(r.itensDeRegras[0]).toMatchObject({
      titulo: 'Regra 54',
      descricao: 'd',
      origens: 2,
      actorId: 'po',
    });
    expect(r.itensDeDecisoes).toEqual([
      expect.objectContaining({
        escolha: 'SQLite',
        contexto: 'um módulo só',
        actorId: 'criativo',
      }),
    ]);
  });

  it('RN-844: lista as PRs executadas da sessão e da execução ligada, a mais recente primeiro, com teto', async () => {
    const criativa = await sessao();
    const execucao = await sessao();
    const alheia = await sessao();
    await acao(criativa, 'open_adr_pr', 'arquiteto', {
      status: 'executed',
      executionResult: { pullRequestId: 'pr-1' },
    });
    await acao(criativa, 'propose_execution_plan', 'dev-lead', {
      status: 'executed',
      executionResult: { sessaoDeExecucao: execucao },
    });
    await acao(execucao, 'pr_open', 'dev-api', {
      status: 'executed',
      executionResult: { pullRequestId: 'pr-2' },
    });
    await acao(execucao, 'pr_open', 'dev-api'); // pendente: não conta
    await acao(alheia, 'pr_open', 'dev-api', {
      status: 'executed',
      executionResult: { pullRequestId: 'pr-9' },
    });

    const { sessoesLidas } = await repo.resumir(projectId, criativa);
    const todas = await repo.prsDasSessoes(projectId, sessoesLidas, 20);
    expect(todas.total).toBe(2);
    expect(todas.itens.map((p) => p.pullRequestId)).toEqual(['pr-2', 'pr-1']);

    const cortada = await repo.prsDasSessoes(projectId, sessoesLidas, 1);
    expect(cortada).toMatchObject({
      total: 2,
      itens: [{ pullRequestId: 'pr-2' }],
    });
  });
});
