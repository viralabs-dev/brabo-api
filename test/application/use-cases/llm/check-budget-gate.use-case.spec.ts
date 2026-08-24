import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  agentAreas,
  projects,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleBudgetRepository } from '../../../../src/infrastructure/persistence/drizzle/budget.repository';
import { DrizzleAgentAreaRepository } from '../../../../src/infrastructure/persistence/drizzle/agent-area.repository';
import { CheckBudgetGateUseCase } from '../../../../src/application/use-cases/llm/check-budget-gate.use-case';
import type { BudgetRepository } from '../../../../src/application/ports/budget-repository.port';

const { db, pool } = createTestDb();
const budgetRepo = new DrizzleBudgetRepository(db);
const areaRepo = new DrizzleAgentAreaRepository(db);
const checkBudgetGate = new CheckBudgetGateUseCase(budgetRepo, areaRepo);

async function setupProject() {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-gate', email: 'gate@brabo.dev' })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: user.id })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: 'core',
      slug: 'core',
      createdBy: user.id,
    })
    .returning();
  return { user, workspace, project };
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('CheckBudgetGateUseCase', () => {
  it('caminho feliz: sem budget configurado, nunca bloqueia', async () => {
    const { project } = await setupProject();
    const result = await checkBudgetGate.execute(
      project.id,
      '00000000-0000-0000-0000-000000000000',
    );
    expect(result).toEqual({ blocked: false });
  });

  it('abaixo do limite, não bloqueia', async () => {
    const { project } = await setupProject();
    await budgetRepo.upsertForProject(project.id, {
      limitMicros: 1000,
      policy: 'block',
    });
    await budgetRepo.incrementSpent(
      (await budgetRepo.findForProject(project.id))!.id,
      500,
    );

    const result = await checkBudgetGate.execute(
      project.id,
      '00000000-0000-0000-0000-000000000000',
    );
    expect(result.blocked).toBe(false);
  });

  it('bloqueia em 100% do limite com policy block', async () => {
    const { project } = await setupProject();
    const budget = await budgetRepo.upsertForProject(project.id, {
      limitMicros: 1000,
      policy: 'block',
    });
    await budgetRepo.incrementSpent(budget.id, 1000);

    const result = await checkBudgetGate.execute(
      project.id,
      '00000000-0000-0000-0000-000000000000',
    );
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/projeto/);
  });

  it('policy allow nunca bloqueia, mesmo em 100%+', async () => {
    const { project } = await setupProject();
    const budget = await budgetRepo.upsertForProject(project.id, {
      limitMicros: 1000,
      policy: 'allow',
    });
    await budgetRepo.incrementSpent(budget.id, 5000);

    const result = await checkBudgetGate.execute(
      project.id,
      '00000000-0000-0000-0000-000000000000',
    );
    expect(result.blocked).toBe(false);
  });

  it('falha ao verificar o budget: fail-closed (bloqueia por padrão)', async () => {
    const throwingRepo: BudgetRepository = {
      findForProject: () => Promise.reject(new Error('db indisponível')),
      findForSession: () => Promise.reject(new Error('db indisponível')),
      upsertForProject: (projectId, input) =>
        budgetRepo.upsertForProject(projectId, input),
      upsertForSession: (sessionId, input) =>
        budgetRepo.upsertForSession(sessionId, input),
      incrementSpent: (budgetId, delta) =>
        budgetRepo.incrementSpent(budgetId, delta),
      updateLastNotified: (budgetId, threshold) =>
        budgetRepo.updateLastNotified(budgetId, threshold),
    };
    const gate = new CheckBudgetGateUseCase(throwingRepo, areaRepo);

    const result = await gate.execute('any-project', 'any-session');
    expect(result.blocked).toBe(true);
  });

  describe('budget de área (ADR 0110, RN-443) — aditivo, não cascata', () => {
    it('bloqueia por área excedida MESMO com projeto e sessão OK', async () => {
      const { project } = await setupProject();
      await db.insert(agentAreas).values({
        projectId: project.id,
        key: 'infra',
        leadAgentId: 'infra',
        budgetMicros: 100,
      });
      await areaRepo.incrementSpent(project.id, 'infra', 100);

      const result = await checkBudgetGate.execute(
        project.id,
        '00000000-0000-0000-0000-000000000000',
        'infra-workflows',
      );
      expect(result.blocked).toBe(true);
      expect(result.reason).toMatch(/área/);
    });

    it('projeto excedido bloqueia MESMO com área dentro do teto (independência)', async () => {
      const { project } = await setupProject();
      const budget = await budgetRepo.upsertForProject(project.id, {
        limitMicros: 100,
        policy: 'block',
      });
      await budgetRepo.incrementSpent(budget.id, 100);
      await db.insert(agentAreas).values({
        projectId: project.id,
        key: 'infra',
        leadAgentId: 'infra',
        budgetMicros: 1_000_000,
      });

      const result = await checkBudgetGate.execute(
        project.id,
        '00000000-0000-0000-0000-000000000000',
        'infra-workflows',
      );
      expect(result.blocked).toBe(true);
      expect(result.reason).toMatch(/projeto/);
    });

    it('sem teto de área (budgetMicros null), nunca bloqueia por área', async () => {
      const { project } = await setupProject();
      await db.insert(agentAreas).values({
        projectId: project.id,
        key: 'infra',
        leadAgentId: 'infra',
      });
      await areaRepo.incrementSpent(project.id, 'infra', 9_999_999);

      const result = await checkBudgetGate.execute(
        project.id,
        '00000000-0000-0000-0000-000000000000',
        'infra-workflows',
      );
      expect(result.blocked).toBe(false);
    });

    it('agente sem área não é afetado pelo teto de outra área', async () => {
      const { project } = await setupProject();
      await db.insert(agentAreas).values({
        projectId: project.id,
        key: 'infra',
        leadAgentId: 'infra',
        budgetMicros: 1,
      });
      await areaRepo.incrementSpent(project.id, 'infra', 1);

      const result = await checkBudgetGate.execute(
        project.id,
        '00000000-0000-0000-0000-000000000000',
        'criativo',
      );
      expect(result.blocked).toBe(false);
    });
  });
});
