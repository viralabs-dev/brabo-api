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

async function evento(sessionId: string, type: string, actorId: string) {
  seq += 1;
  await db.insert(sessionEvents).values({
    id: `evt-${seq}`,
    sessionId,
    seq,
    type,
    actorKind: 'agent',
    actorId,
    payload: {},
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
});
