import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../support/test-db';
import {
  agentAreaMembers,
  agentAreas,
  projects,
  users,
  workspaces,
} from '../../src/db/schema';

/**
 * O backfill da migração 0038 (FASE 18, RN-094).
 *
 * Diferente do teste da 0033, aqui a migração É executada: ela é só dado, e
 * dado idempotente — o que permite rodá-la contra uma linha criada à mão, que
 * é exatamente o projeto "de antes da correção".
 */
const { db, pool } = createTestDb();

const MIGRACAO = readFileSync(
  join(__dirname, '../../src/db/migrations/0038_wandering_lila_cheney.sql'),
  'utf-8',
);

async function rodarBackfill() {
  for (const statement of MIGRACAO.split('--> statement-breakpoint')) {
    await db.execute(sql.raw(statement));
  }
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

/** Um projeto gravado direto na tabela: o que existia antes da RN-094. */
async function projetoAntigo(slug: string) {
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
  return projeto;
}

async function areasDe(projectId: string) {
  const linhas = await db
    .select()
    .from(agentAreas)
    .where(sql`${agentAreas.projectId} = ${projectId}`);
  const membros = await db.select().from(agentAreaMembers);
  return linhas
    .map((a) => ({
      key: a.key,
      lead: a.leadAgentId,
      maxParallel: a.maxParallel,
      members: membros
        .filter((m) => m.areaId === a.id)
        .map((m) => m.agentId)
        .sort(),
    }))
    .sort((x, y) => x.key.localeCompare(y.key));
}

describe('migração 0038 — backfill de agent_areas (RN-094)', () => {
  it('projeto que já existia passa a ter as três áreas', async () => {
    const projeto = await projetoAntigo('antigo');

    expect(await areasDe(projeto.id)).toEqual([]);

    await rodarBackfill();

    expect(await areasDe(projeto.id)).toEqual([
      { key: 'dev', lead: 'dev-lead', maxParallel: 2, members: [] },
      {
        key: 'infra',
        lead: 'infra',
        maxParallel: 2,
        members: ['infra-workflows'],
      },
      {
        key: 'qa',
        lead: 'qa',
        maxParallel: 2,
        members: ['qa-automacao', 'qa-performance-seguranca'],
      },
    ]);
  });

  it('rodar duas vezes não duplica nem reescreve — o backfill é idempotente', async () => {
    // Importa porque o mesmo INSERT roda depois do seeding do código: sem o
    // `ON CONFLICT`, a migração explodiria na unique de (project_id, key).
    const projeto = await projetoAntigo('duas-vezes');

    await rodarBackfill();
    await db.execute(
      sql`UPDATE agent_areas SET max_parallel = 5 WHERE project_id = ${projeto.id} AND key = 'dev'`,
    );
    await rodarBackfill();

    const areas = await areasDe(projeto.id);
    expect(areas).toHaveLength(3);
    // O teto que o usuário decidiu sobrevive: a migração faz a área existir,
    // não decide gasto.
    expect(areas.find((a) => a.key === 'dev')?.maxParallel).toBe(5);
  });

  it('sem projeto nenhum, o backfill não grava nada', async () => {
    await rodarBackfill();

    expect(await db.select().from(agentAreas)).toEqual([]);
  });
});
