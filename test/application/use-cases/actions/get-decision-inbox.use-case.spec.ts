import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  epics,
  moduleMaps,
  projectMembers,
  projects,
  proposedActions,
  psychologistAnalyses,
  psychologistHypotheses,
  sessions,
  stories,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleDecisionInboxRepository } from '../../../../src/infrastructure/persistence/drizzle/decision-inbox.repository';
import {
  GetDecisionInboxUseCase,
  TETO_DE_ITENS_POR_FILA,
} from '../../../../src/application/use-cases/actions/get-decision-inbox.use-case';
import type { WorkspaceRepository } from '../../../../src/application/ports/workspace-repository.port';
import type { Role } from '../../../../src/domain/iam/role';

const { db, pool } = createTestDb();
const repo = new DrizzleDecisionInboxRepository(db);

let n = 0;
const casoDeUso = (papelDoWorkspace: Role | null) =>
  new GetDecisionInboxUseCase(repo, {
    findMemberRole: () => Promise.resolve(papelDoWorkspace),
  } as unknown as WorkspaceRepository);

interface P {
  id: string;
  sessionId: string;
  epicId: string;
}

async function cenario(qtdProjetos = 1) {
  n += 1;
  const [u] = await db
    .insert(users)
    .values({ keycloakSub: `s${n}`, email: `u${n}@x.dev`, name: 'u' })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `w${n}`, slug: `w${n}`, createdBy: u.id })
    .returning();
  const ps: P[] = [];
  for (let i = 0; i < qtdProjetos; i++) {
    const [p] = await db
      .insert(projects)
      .values({
        workspaceId: ws.id,
        name: `p${i}`,
        slug: `p${i}`,
        createdBy: u.id,
      })
      .returning();
    const [s] = await db
      .insert(sessions)
      .values({ projectId: p.id, createdBy: u.id })
      .returning();
    const [e] = await db
      .insert(epics)
      .values({ projectId: p.id, sessionId: s.id, title: 'E' })
      .returning();
    ps.push({ ...p, sessionId: s.id, epicId: e.id });
  }
  return { u, ws, ps };
}

const acao = (p: P, over: Partial<typeof proposedActions.$inferInsert> = {}) =>
  db.insert(proposedActions).values({
    projectId: p.id,
    sessionId: p.sessionId,
    actionType: 'terminal',
    resolvedPolicy: 'require_approval',
    actorKind: 'agent',
    actorId: 'dev-x',
    ...over,
  });

const historia = (p: P, over: Partial<typeof stories.$inferInsert> = {}) =>
  db.insert(stories).values({
    epicId: p.epicId,
    projectId: p.id,
    sessionId: p.sessionId,
    title: 'H',
    ...over,
  });

async function hipotese(
  p: P,
  superseded: boolean,
  status = 'proposed',
  decidedAt?: Date,
) {
  const [a] = await db
    .insert(psychologistAnalyses)
    .values({
      projectId: p.id,
      sessionId: p.sessionId,
      tier: 't',
      superseded,
      eventCountAtAnalysis: 1,
    })
    .returning();
  await db.insert(psychologistHypotheses).values({
    projectId: p.id,
    sessionId: p.sessionId,
    analysisId: a.id,
    agenteAlvo: 'po',
    observacao: 'o',
    hipotese: 'h',
    sugestao: 's',
    confiancaPercent: 50,
    status,
    decidedAt,
  });
}

async function contarConsultas(fn: () => Promise<unknown>) {
  const original: unknown = pool.query.bind(pool);
  let total = 0;
  (pool as { query: unknown }).query = (...args: unknown[]) => {
    total += 1;
    return (original as (...a: unknown[]) => unknown)(...args);
  };
  try {
    await fn();
  } finally {
    (pool as { query: unknown }).query = original;
  }
  return total;
}

describe('GetDecisionInboxUseCase (AT-928)', () => {
  beforeEach(async () => {
    await truncateAll(db);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('separa as cinco filas, sem total na raiz, e respeita arquivadas e superseded', async () => {
    const { u, ws, ps } = await cenario(1);
    const [p] = ps;
    await acao(p);
    await acao(p, { actionType: 'git_merge', actorKind: 'user', actorId: 'u' });
    await historia(p, { proposedReady: true, moduleIds: ['m'] });
    await historia(p, { proposedReady: true, archivedAt: new Date() });
    await historia(p, { moduleIds: [] }); // sem módulo: pendência
    await db.insert(moduleMaps).values({
      projectId: p.id,
      sessionId: p.sessionId,
      version: 1,
      modules: [{ name: 'm' }] as never,
    });
    await hipotese(p, false);
    await hipotese(p, true);

    const r = await casoDeUso('developer').execute(ws.id, u.id);

    expect(Object.keys(r)).not.toContain('total');
    expect(r.filas.aprovacoes).toMatchObject({ total: 1, truncada: false });
    expect(r.filas.aprovacoes.itens[0].acao.actionType).toBe('terminal');
    expect(r.filas.prs.itens.map((i) => i.acao.actionType)).toEqual([
      'git_merge',
    ]);
    expect(r.filas.promocoes.total).toBe(1);
    expect(r.filas.arquitetura.total).toBe(1); // só a sem módulo: a de módulo `m` resolve e a arquivada sai
    expect(r.filas.hipoteses.total).toBe(1);
    expect(r.projetos[0]).toMatchObject({
      aprovacoes: 1,
      prs: 1,
      promocoes: 1,
      hipoteses: 1,
      agentesAguardando: ['dev-x'],
    });
  });

  it('RN-471 nos dois sentidos: o papel de projeto sobrepõe o de workspace', async () => {
    const { u, ws, ps } = await cenario(2);
    const [x, y] = ps;
    for (const p of ps) {
      await acao(p);
      await historia(p, { moduleIds: [] });
    }
    // developer no workspace, rebaixado a viewer em X; em Y o inverso.
    await db
      .insert(projectMembers)
      .values({ projectId: x.id, userId: u.id, role: 'viewer' });
    const rebaixado = await casoDeUso('developer').execute(ws.id, u.id);
    const px = rebaixado.projetos.find((p) => p.projectId === x.id)!;
    expect(px).toMatchObject({ aprovacoes: 0, arquitetura: 1 });
    expect(
      rebaixado.projetos.find((p) => p.projectId === y.id)!.aprovacoes,
    ).toBe(1);

    await db
      .insert(projectMembers)
      .values({ projectId: y.id, userId: u.id, role: 'developer' });
    const elevado = await casoDeUso('viewer').execute(ws.id, u.id);
    expect(elevado.projetos.find((p) => p.projectId === y.id)!.aprovacoes).toBe(
      1,
    );
    expect(elevado.projetos.find((p) => p.projectId === x.id)!.aprovacoes).toBe(
      0,
    );
  });

  it('sem papel no workspace: 403', async () => {
    const { u, ws } = await cenario(1);
    await expect(casoDeUso(null).execute(ws.id, u.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('teto: 60 pendências devolvem 50 itens, total 60, truncada, mais antigas primeiro', async () => {
    const { u, ws, ps } = await cenario(1);
    for (let i = 0; i < 60; i++) {
      await acao(ps[0], {
        payload: { i },
        createdAt: new Date(2026, 0, 1, 0, i),
      });
    }
    const r = await casoDeUso('developer').execute(ws.id, u.id);
    const f = r.filas.aprovacoes;
    expect(f.itens).toHaveLength(TETO_DE_ITENS_POR_FILA);
    expect(f.total).toBe(60);
    expect(f.truncada).toBe(true);
    expect((f.itens[0].acao.payload as { i: number }).i).toBe(0);
    expect(r.projetos[0].aprovacoes).toBe(60);
  });

  it('orçamento: o mesmo número de consultas com 1 e com 25 projetos', async () => {
    const a = await cenario(1);
    const b = await cenario(25);
    for (const p of b.ps) await acao(p);
    const com1 = await contarConsultas(() =>
      casoDeUso('developer').execute(a.ws.id, a.u.id),
    );
    const com25 = await contarConsultas(() =>
      casoDeUso('developer').execute(b.ws.id, b.u.id),
    );
    expect(com25).toBe(com1);
    expect(com1).toBeGreaterThan(0);
  });

  it('decided: janela, ações decididas, recusa de promoção, e arquitetura vazia', async () => {
    const { u, ws, ps } = await cenario(1);
    const [p] = ps;
    await acao(p, { status: 'approved' });
    await acao(p, { status: 'denied', updatedAt: new Date(2020, 0, 1) });
    await acao(p); // pendente: fora
    await historia(p, { returnedAt: new Date(), moduleIds: [] });
    await hipotese(p, false, 'accepted', new Date());

    const r = await casoDeUso('developer').execute(ws.id, u.id, {
      status: 'decided',
    });
    expect(r.status).toBe('decided');
    expect(r.filas.aprovacoes.total).toBe(1);
    expect(r.filas.promocoes.itens[0].decididaEm).not.toBeNull();
    expect(r.filas.hipoteses.itens[0].situacao).toBe('accepted');
    expect(r.filas.arquitetura.total).toBe(0);
  });
});
