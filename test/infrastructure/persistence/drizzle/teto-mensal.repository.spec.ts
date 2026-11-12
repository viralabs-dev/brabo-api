import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  agentAreas,
  budgets,
  projects,
  sessions,
  tokenUsage,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleBudgetRepository } from '../../../../src/infrastructure/persistence/drizzle/budget.repository';
import { DrizzleAgentAreaRepository } from '../../../../src/infrastructure/persistence/drizzle/agent-area.repository';
import { CheckBudgetGateUseCase } from '../../../../src/application/use-cases/llm/check-budget-gate.use-case';
import {
  gastoVigente,
  inicioDoMes,
  periodoDoTeto,
} from '../../../../src/domain/llm/periodo-do-teto';

// ADR 0296 (RN-1168..1171): teto mensal em UTC e teto do workspace.
const { db, pool } = createTestDb();
const repo = new DrizzleBudgetRepository(db);
const areaRepo = new DrizzleAgentAreaRepository(db);
const gate = new CheckBudgetGateUseCase(repo, areaRepo);

const MES_PASSADO = '2020-01-01';

async function setup(slug = 'acme') {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: `sub-${slug}`, email: `${slug}@brabo.dev` })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: slug, slug, createdBy: user.id })
    .returning();
  const mk = async (s: string) =>
    (
      await db
        .insert(projects)
        .values({ workspaceId: ws.id, name: s, slug: s, createdBy: user.id })
        .returning()
    )[0];
  return { user, ws, mk };
}

beforeEach(async () => {
  await truncateAll(db);
});
afterAll(async () => {
  await pool.end();
});

describe('periodo-do-teto (puro)', () => {
  it('virada exata em UTC', () => {
    expect(inicioDoMes(new Date('2026-11-30T23:59:59.999Z'))).toBe(
      '2026-11-01',
    );
    expect(inicioDoMes(new Date('2026-12-01T00:00:00.000Z'))).toBe(
      '2026-12-01',
    );
  });

  it('gasto de período vencido vale 0', () => {
    const now = new Date('2026-11-12T10:00:00Z');
    expect(gastoVigente('2026-11-01', 500, now)).toBe(500);
    expect(gastoVigente('2026-10-01', 500, now)).toBe(0);
  });

  it('previsão linear; dia 1 usa no mínimo 1 dia; fevereiro tem 28', () => {
    const p = periodoDoTeto(100, new Date('2026-11-16T00:00:00Z'));
    expect(p.diasRestantes).toBe(15);
    expect(p.previsaoMicros).toBe(200); // 100 × 30 / 15
    expect(
      periodoDoTeto(0, new Date('2026-02-10T00:00:00Z')).previsaoMicros,
    ).toBe(0);
    const d1 = periodoDoTeto(10, new Date('2026-11-01T00:00:00Z'));
    expect(d1.previsaoMicros).toBe(300);
    expect(d1.fim).toBe('2026-12-01');
  });
});

describe('teto de projeto mensal', () => {
  it('período vencido: find devolve 0, incrementSpent recomeça do delta e rearma o limiar', async () => {
    const { mk } = await setup();
    const p = await mk('core');
    const b = await repo.upsertForProject(p.id, {
      limitMicros: 100,
      policy: 'block',
    });
    await db
      .update(budgets)
      .set({
        periodoInicio: MES_PASSADO,
        spentMicros: 100,
        lastThresholdNotified: 100,
      })
      .where(eq(budgets.id, b.id));

    const lido = await repo.findForProject(p.id);
    expect(lido?.spentMicros).toBe(0);
    expect(lido?.lastThresholdNotified).toBe(0);
    expect(
      (await gate.execute(p.id, '00000000-0000-0000-0000-000000000000'))
        .blocked,
    ).toBe(false);

    const novo = await repo.incrementSpent(b.id, 7);
    expect(novo.spentMicros).toBe(7);
    expect(novo.lastThresholdNotified).toBe(0);
    expect(novo.periodoInicio).toBe(inicioDoMes(new Date()));
    expect((await repo.incrementSpent(b.id, 3)).spentMicros).toBe(10);
  });

  it('falha: no mês corrente com spent = limite, o gate bloqueia', async () => {
    const { mk } = await setup();
    const p = await mk('core');
    const b = await repo.upsertForProject(p.id, {
      limitMicros: 10,
      policy: 'block',
    });
    await repo.incrementSpent(b.id, 10);
    const r = await gate.execute(p.id, '00000000-0000-0000-0000-000000000000');
    expect(r).toEqual({
      blocked: true,
      reason: 'Budget do projeto atingiu o teto do mês',
    });
  });

  it('teto de sessão nunca zera (período nulo)', async () => {
    const { user, mk } = await setup();
    const p = await mk('core');
    const [s] = await db
      .insert(sessions)
      .values({ projectId: p.id, createdBy: user.id })
      .returning();
    const b = await repo.upsertForSession(s.id, {
      limitMicros: 10,
      policy: 'block',
    });
    expect(b.periodoInicio).toBeNull();
    expect((await repo.incrementSpent(b.id, 4)).spentMicros).toBe(4);
    expect((await repo.incrementSpent(b.id, 4)).spentMicros).toBe(8);
  });
});

describe('teto do workspace', () => {
  it('soma de projetos: o workspace bloqueia com cada projeto livre', async () => {
    const { mk, ws } = await setup();
    const a = await mk('a');
    const b = await mk('b');
    const w = await repo.upsertForWorkspace(ws.id, {
      limitMicros: 10,
      policy: 'block',
    });
    await repo.upsertForProject(a.id, { limitMicros: 100, policy: 'block' });
    // o gasto de dois projetos cai na MESMA linha do workspace
    expect((await repo.findForWorkspaceOfProject(a.id))?.id).toBe(w.id);
    expect((await repo.findForWorkspaceOfProject(b.id))?.id).toBe(w.id);
    await repo.incrementSpent(w.id, 6);
    await repo.incrementSpent(w.id, 4);
    const r = await gate.execute(b.id, '00000000-0000-0000-0000-000000000000');
    expect(r).toEqual({
      blocked: true,
      reason: 'Budget do workspace atingiu o teto do mês',
    });
  });

  it('allow não bloqueia; o projeto bloqueia com o workspace livre', async () => {
    const { mk, ws } = await setup();
    const a = await mk('a');
    const w = await repo.upsertForWorkspace(ws.id, {
      limitMicros: 10,
      policy: 'allow',
    });
    await repo.incrementSpent(w.id, 50);
    const sem = '00000000-0000-0000-0000-000000000000';
    expect((await gate.execute(a.id, sem)).blocked).toBe(false);
    const pb = await repo.upsertForProject(a.id, {
      limitMicros: 5,
      policy: 'block',
    });
    await repo.incrementSpent(pb.id, 5);
    expect((await gate.execute(a.id, sem)).reason).toBe(
      'Budget do projeto atingiu o teto do mês',
    );
  });

  it('o banco recusa linha com dois escopos', async () => {
    const { mk, ws } = await setup();
    const a = await mk('a');
    await expect(
      db.insert(budgets).values({
        projectId: a.id,
        workspaceId: ws.id,
        periodoInicio: MES_PASSADO,
        limitMicros: 1,
      }),
    ).rejects.toThrow();
  });
});

describe('teto de área mensal', () => {
  it('período vencido zera na leitura e recomeça no incremento', async () => {
    const { mk } = await setup();
    const p = await mk('core');
    await db.insert(agentAreas).values({
      projectId: p.id,
      key: 'dev',
      leadAgentId: 'dev-lead',
      budgetMicros: 100,
      spentMicros: 90,
      periodoInicio: MES_PASSADO,
    });
    expect((await areaRepo.findByKey(p.id, 'dev'))?.spentMicros).toBe(0);
    expect((await areaRepo.incrementSpent(p.id, 'dev', 5)).spentMicros).toBe(5);
  });
});

describe('migração 0089: recálculo do mês', () => {
  it('spent_micros = soma de token_usage do mês corrente (UTC), por projeto e por área', async () => {
    const { user, mk } = await setup();
    const p = await mk('core');
    const [s] = await db
      .insert(sessions)
      .values({ projectId: p.id, createdBy: user.id })
      .returning();
    const base = {
      sessionId: s.id,
      provider: 'anthropic' as const,
      modelName: 'm',
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
      bindingOrigin: null,
    };
    await db.insert(tokenUsage).values([
      { ...base, actorKind: 'agent', actorId: 'dev-api', costMicros: 60 },
      { ...base, actorKind: 'agent', actorId: 'qa', costMicros: 30 },
      { ...base, actorKind: 'user', actorId: 'u', costMicros: 10 },
    ]);
    // linha de mês passado não conta
    await db.insert(tokenUsage).values({
      ...base,
      actorKind: 'agent',
      actorId: 'dev-api',
      costMicros: 999,
      createdAt: new Date('2020-01-15T00:00:00Z'),
    });
    // estado PRÉ-migração: acumulado, sem período
    const [b] = await db
      .insert(budgets)
      .values({
        projectId: p.id,
        periodoInicio: MES_PASSADO,
        limitMicros: 100,
        spentMicros: 5000,
      })
      .returning();
    await db.insert(agentAreas).values({
      projectId: p.id,
      key: 'dev',
      leadAgentId: 'dev-lead',
      spentMicros: 5000,
    });

    const arquivo = readFileSync(
      'src/db/migrations/0089_teto_mensal_e_do_workspace.sql',
      'utf8',
    );
    const updates = arquivo
      .split('--> statement-breakpoint')
      .map((x) => x.trim())
      .filter((x) => /^(--[^\n]*\n)*UPDATE/m.test(x));
    expect(updates).toHaveLength(3);
    for (const u of updates) await db.execute(sql.raw(u));

    const [bd] = await db.select().from(budgets).where(eq(budgets.id, b.id));
    expect(bd.spentMicros).toBe(100); // 60 + 30 + 10
    expect(bd.lastThresholdNotified).toBe(100); // 100 >= limite 100
    const [area] = await db.select().from(agentAreas);
    expect(area.spentMicros).toBe(60); // só o dev
    expect(area.periodoInicio).toBe(inicioDoMes(new Date()));
  });
});
