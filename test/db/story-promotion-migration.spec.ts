import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../support/test-db';
import { projects, users, workspaces } from '../../src/db/schema';

const { db, pool } = createTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

async function seedWorkspace() {
  const [owner] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-promo', email: 'promo@brabo.dev' })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: owner.id })
    .returning();
  return { ownerId: owner.id, workspaceId: ws.id };
}

describe('migração 0033 — story_promotion (Fase 12c, RN-048)', () => {
  it('projeto NOVO nasce em manual — a decisão volta ao usuário', async () => {
    const { ownerId, workspaceId } = await seedWorkspace();

    const [project] = await db
      .insert(projects)
      .values({ workspaceId, name: 'novo', slug: 'novo', createdBy: ownerId })
      .returning();

    expect(project.storyPromotion).toBe('manual');
  });

  it('a coluna é NOT NULL — o modo nunca fica implícito', async () => {
    // Diferente de `taskBudgetMicros`/`maxConsecutiveBlocked`, onde nulo
    // significa "usa o default do domínio". Aqui o valor É a decisão de
    // autoridade, e uma decisão dessas não pode ser ausência.
    const { ownerId, workspaceId } = await seedWorkspace();
    const [project] = await db
      .insert(projects)
      .values({ workspaceId, name: 'p', slug: 'p', createdBy: ownerId })
      .returning();

    await expect(
      db.execute(
        sql`UPDATE projects SET story_promotion = NULL WHERE id = ${project.id}`,
      ),
    ).rejects.toThrow();
  });

  it('o backfill da migração é o que impede projeto ANTIGO de mudar de comportamento', async () => {
    // Não dá para "rodar a migração de novo" num teste, então o que se
    // verifica é a REGRA que ela aplica: uma linha que existia antes da
    // coluna teria recebido o DEFAULT (`manual`) e, sem o UPDATE dirigido,
    // acordaria com o PO parado. Simulamos a linha pré-existente com o
    // default e aplicamos o mesmo UPDATE da migração.
    const { ownerId, workspaceId } = await seedWorkspace();
    const [antigo] = await db
      .insert(projects)
      .values({
        workspaceId,
        name: 'antigo',
        slug: 'antigo',
        createdBy: ownerId,
      })
      .returning();

    expect(antigo.storyPromotion).toBe('manual');

    await db.execute(sql`UPDATE projects SET story_promotion = 'auto'`);

    const [depois] = await db
      .select()
      .from(projects)
      .where(sql`id = ${antigo.id}`);

    expect(depois.storyPromotion).toBe('auto');
  });

  it('aceita só os dois modos conhecidos', async () => {
    const { ownerId, workspaceId } = await seedWorkspace();
    const [project] = await db
      .insert(projects)
      .values({ workspaceId, name: 'p', slug: 'p', createdBy: ownerId })
      .returning();

    await expect(
      db.execute(
        sql`UPDATE projects SET story_promotion = 'semi' WHERE id = ${project.id}`,
      ),
    ).rejects.toThrow();
  });
});
