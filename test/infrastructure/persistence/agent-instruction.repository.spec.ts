import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, truncateAll } from '../../support/test-db';
import { projects, users, workspaces } from '../../../src/db/schema';
import { DrizzleAgentInstructionRepository } from '../../../src/infrastructure/persistence/drizzle/agent-instruction.repository';

const { db, pool } = createTestDb();
const repo = new DrizzleAgentInstructionRepository(db);

async function seedProject(): Promise<string> {
  const [owner] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-ai', email: 'ai@brabo.dev' })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: owner.id })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: ws.id,
      name: 'core',
      slug: 'core',
      createdBy: owner.id,
    })
    .returning();
  return project.id;
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('DrizzleAgentInstructionRepository.upsert (seed versionado)', () => {
  it('insere na primeira vez com version 1', async () => {
    const projectId = await seedProject();
    const row = await repo.upsert({
      projectId,
      agent: 'criativo',
      content: 'v1',
    });
    expect(row.version).toBe(1);
    expect(row.content).toBe('v1');
  });

  it('conteúdo idêntico NÃO bumpa version', async () => {
    const projectId = await seedProject();
    await repo.upsert({ projectId, agent: 'criativo', content: 'mesma' });
    const again = await repo.upsert({
      projectId,
      agent: 'criativo',
      content: 'mesma',
    });
    expect(again.version).toBe(1);
  });

  it('conteúdo alterado bumpa version e atualiza o texto', async () => {
    const projectId = await seedProject();
    await repo.upsert({ projectId, agent: 'criativo', content: 'v1' });
    const bumped = await repo.upsert({
      projectId,
      agent: 'criativo',
      content: 'v2 melhorado',
    });
    expect(bumped.version).toBe(2);
    expect(bumped.content).toBe('v2 melhorado');

    const found = await repo.findByProjectAndAgent(projectId, 'criativo');
    expect(found?.version).toBe(2);
  });
});
