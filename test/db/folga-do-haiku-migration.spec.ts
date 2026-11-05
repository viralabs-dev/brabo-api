import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../support/test-db';
import { models } from '../../src/db/schema';

/** A migração 0083 (AT-743, RN-1007): folga 12288 só no Haiku 5.5 da Anthropic. */
const { db, pool } = createTestDb();

const MIGRACAO = readFileSync(
  join(__dirname, '../../src/db/migrations/0083_folga_do_haiku_5_5.sql'),
  'utf-8',
);

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

async function orcamentos() {
  const linhas = await db.select().from(models);
  return Object.fromEntries(
    linhas.map((m) => [`${m.provider}/${m.name}`, m.reasoningBudget]),
  );
}

describe('migração 0083 — folga do Haiku 5.5 (RN-1007)', () => {
  it('grava 12288 só no haiku-5-5 da Anthropic e é idempotente', async () => {
    await db.insert(models).values([
      { provider: 'anthropic', name: 'claude-haiku-5-5', displayName: 'h' },
      { provider: 'anthropic', name: 'claude-sonnet-5-5', displayName: 's' },
      { provider: 'openrouter', name: 'claude-haiku-5-5', displayName: 'o' },
      {
        provider: 'openrouter',
        name: 'qwen/qwen3.7-flash',
        displayName: 'q',
        reasoningBudget: 2048,
      },
    ]);

    await db.execute(sql.raw(MIGRACAO));
    await db.execute(sql.raw(MIGRACAO));

    expect(await orcamentos()).toEqual({
      'anthropic/claude-haiku-5-5': 12288,
      'anthropic/claude-sonnet-5-5': null,
      'openrouter/claude-haiku-5-5': null,
      'openrouter/qwen/qwen3.7-flash': 2048,
    });
  });
});
