import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  agentAreas,
  projects,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleAgentAreaRepository } from '../../../../src/infrastructure/persistence/drizzle/agent-area.repository';

const { db, pool } = createTestDb();
const repo = new DrizzleAgentAreaRepository(db);

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

async function criarProjetoComArea(key = 'infra') {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: `sub-area-${key}`, email: `area-${key}@brabo.dev` })
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
  await db.insert(agentAreas).values({
    projectId: project.id,
    key,
    leadAgentId: key,
  });
  return project;
}

describe('DrizzleAgentAreaRepository — budget de área (ADR 0109, RN-440)', () => {
  it('nasce com budgetMicros null e spentMicros 0', async () => {
    const project = await criarProjetoComArea();
    const area = await repo.findByKey(project.id, 'infra');
    expect(area?.budgetMicros).toBeNull();
    expect(area?.spentMicros).toBe(0);
  });

  describe('setBudget', () => {
    it('grava o teto', async () => {
      const project = await criarProjetoComArea();
      const area = await repo.setBudget(project.id, 'infra', 5_000_000);
      expect(area.budgetMicros).toBe(5_000_000);
    });

    it('null limpa o teto', async () => {
      const project = await criarProjetoComArea();
      await repo.setBudget(project.id, 'infra', 5_000_000);
      const area = await repo.setBudget(project.id, 'infra', null);
      expect(area.budgetMicros).toBeNull();
    });

    it('área inexistente lança NotFoundException', async () => {
      const project = await criarProjetoComArea();
      await expect(
        repo.setBudget(project.id, 'nao-existe', 100),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('incrementSpent', () => {
    it('soma ao gasto acumulado', async () => {
      const project = await criarProjetoComArea();
      await repo.incrementSpent(project.id, 'infra', 100);
      const area = await repo.incrementSpent(project.id, 'infra', 50);
      expect(area.spentMicros).toBe(150);
    });

    it('é atômico sob incremento concorrente', async () => {
      const project = await criarProjetoComArea();
      const CONCURRENCY = 20;
      const delta = 10;

      await Promise.all(
        Array.from({ length: CONCURRENCY }, () =>
          repo.incrementSpent(project.id, 'infra', delta),
        ),
      );

      const area = await repo.findByKey(project.id, 'infra');
      expect(area?.spentMicros).toBe(CONCURRENCY * delta);
    });

    it('área inexistente lança NotFoundException', async () => {
      const project = await criarProjetoComArea();
      await expect(
        repo.incrementSpent(project.id, 'nao-existe', 10),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
