import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../support/test-db';
import { agentAreas, projects, users, workspaces } from '../../src/db/schema';

/**
 * A migração 0073 (AT-599): dev 5, qa 4, infra 2 em TODAS as linhas.
 * Decisão do dono (22/10): sobrescreve o que estava decidido, em todos os
 * projetos. Roda o SQL de verdade contra linhas com valores antigos.
 */
const { db, pool } = createTestDb();

const MIGRACAO = readFileSync(
  join(
    __dirname,
    '../../src/db/migrations/0073_paralelismo_padrao_por_area.sql',
  ),
  'utf-8',
);

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

async function projetoComAreas(slug: string, valores: Record<string, number>) {
  const [owner] = await db
    .insert(users)
    .values({ keycloakSub: `sub-${slug}`, email: `${slug}@brabo.dev` })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: slug, slug, createdBy: owner.id })
    .returning();
  const [projeto] = await db
    .insert(projects)
    .values({ workspaceId: ws.id, name: slug, slug, createdBy: owner.id })
    .returning();
  for (const [key, maxParallel] of Object.entries(valores)) {
    await db
      .insert(agentAreas)
      .values({ projectId: projeto.id, key, leadAgentId: key, maxParallel });
  }
  return projeto;
}

async function tetos() {
  const linhas = await db.select().from(agentAreas);
  return Object.fromEntries(linhas.map((a) => [`${a.key}`, a.maxParallel]));
}

describe('migração 0073 — teto padrão por área (AT-599)', () => {
  it('linhas com valores antigos (2, 3, 7) terminam em dev 5, qa 4, infra 2', async () => {
    await projetoComAreas('a', { dev: 2, qa: 3, infra: 7 });
    await projetoComAreas('b', { dev: 7, qa: 2, infra: 3 });

    await db.execute(sql.raw(MIGRACAO));

    const linhas = await db.select().from(agentAreas);
    expect(linhas).toHaveLength(6);
    for (const a of linhas) {
      const esperado = { dev: 5, qa: 4, infra: 2 }[a.key];
      expect(a.maxParallel).toBe(esperado);
    }
  });

  it('chave fora das três áreas do catálogo não é tocada', async () => {
    await projetoComAreas('c', { dev: 2, outra: 9 });

    await db.execute(sql.raw(MIGRACAO));

    expect(await tetos()).toMatchObject({ dev: 5, outra: 9 });
  });

  it('rodar duas vezes dá o mesmo resultado', async () => {
    await projetoComAreas('d', { dev: 2, qa: 2, infra: 2 });

    await db.execute(sql.raw(MIGRACAO));
    await db.execute(sql.raw(MIGRACAO));

    expect(await tetos()).toEqual({ dev: 5, qa: 4, infra: 2 });
  });
});
