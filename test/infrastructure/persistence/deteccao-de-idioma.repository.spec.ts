import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../../support/test-db';
import {
  detectedLanguageDeclines,
  projects,
  sessionEvents,
  sessions,
  users,
  workspaces,
} from '../../../src/db/schema';
import { DrizzleDeteccaoDeIdiomaRepository } from '../../../src/infrastructure/persistence/drizzle/deteccao-de-idioma.repository';

const { db, pool } = createTestDb();
const repo = new DrizzleDeteccaoDeIdiomaRepository(db);

/**
 * O que a detecção de idioma lê e grava no BANCO de verdade (AT-163, RN-624):
 * as mensagens do AUTOR em todas as sessões, pelo índice parcial; a recusa; e
 * a confirmação, que respeita o CHECK do par da RN-618.
 */
async function seed() {
  const [ana] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-ana', email: 'ana@brabo.dev' })
    .returning();
  const [bob] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-bob', email: 'bob@brabo.dev' })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: ana.id })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: ws.id,
      name: 'core',
      slug: 'core',
      createdBy: ana.id,
    })
    .returning();
  const [s1] = await db
    .insert(sessions)
    .values({ projectId: project.id, createdBy: ana.id })
    .returning();
  const [s2] = await db
    .insert(sessions)
    .values({ projectId: project.id, createdBy: ana.id })
    .returning();
  return { ana, bob, s1, s2 };
}

let contador = 0;
async function evento(
  sessionId: string,
  seq: number,
  type: string,
  actorKind: 'user' | 'agent',
  actorId: string,
  payload: unknown,
  createdAt: string,
) {
  contador += 1;
  await db.insert(sessionEvents).values({
    id: `01JEVENTO${String(contador).padStart(17, '0')}`,
    sessionId,
    seq,
    type,
    actorKind,
    actorId,
    payload,
    createdAt: new Date(createdAt),
  });
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('ultimasEvidencias (RN-624)', () => {
  it('lê só o AUTOR, só os tipos de evidência, em TODAS as sessões, do mais antigo ao mais novo', async () => {
    const { ana, bob, s1, s2 } = await seed();
    await evento(
      s1.id,
      1,
      'chat.message',
      'user',
      ana.id,
      { text: 'um' },
      '2026-09-01T10:00:00Z',
    );
    await evento(
      s1.id,
      2,
      'agent.response',
      'agent',
      'criativo',
      { text: 'resposta' },
      '2026-09-01T10:01:00Z',
    );
    await evento(
      s2.id,
      1,
      'chat.message',
      'user',
      bob.id,
      { text: 'do bob' },
      '2026-09-01T10:02:00Z',
    );
    await evento(
      s2.id,
      2,
      'chat.structured_question_answered',
      'user',
      ana.id,
      { answers: { q: 'dois' } },
      '2026-09-01T10:03:00Z',
    );
    await evento(
      s2.id,
      3,
      'chat.message',
      'user',
      ana.id,
      { text: 'três' },
      '2026-09-01T10:04:00Z',
    );

    const lidas = await repo.ultimasEvidencias(ana.id, 10);

    expect(lidas.map((e) => [e.sessionId, e.tipo, e.payload])).toEqual([
      [s1.id, 'chat.message', { text: 'um' }],
      [s2.id, 'chat.structured_question_answered', { answers: { q: 'dois' } }],
      [s2.id, 'chat.message', { text: 'três' }],
    ]);
  });

  it('o teto corta as MAIS ANTIGAS', async () => {
    const { ana, s1 } = await seed();
    for (let i = 1; i <= 5; i++) {
      await evento(
        s1.id,
        i,
        'chat.message',
        'user',
        ana.id,
        { text: `m${i}` },
        `2026-09-01T10:0${i}:00Z`,
      );
    }

    const lidas = await repo.ultimasEvidencias(ana.id, 2);

    expect(lidas.map((e) => e.payload)).toEqual([
      { text: 'm4' },
      { text: 'm5' },
    ]);
  });

  it('a consulta é servida pelo índice parcial (sem varrer o event log)', async () => {
    const { ana } = await seed();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      const { rows } = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT session_id, type, payload FROM session_events
         WHERE actor_kind = 'user' AND actor_id = $1
           AND type IN ('chat.message', 'chat.structured_question_answered')
         ORDER BY created_at DESC, seq DESC LIMIT 22`,
        [ana.id],
      );
      await client.query('ROLLBACK');
      expect(rows.map((r) => r['QUERY PLAN']).join('\n')).toContain(
        'session_events_evidencia_de_idioma_idx',
      );
    } finally {
      client.release();
    }
  });
});

describe('recusar e confirmar (RN-624)', () => {
  it('recusar é idempotente e vira o conjunto de recusados', async () => {
    const { ana } = await seed();

    await repo.recusar(ana.id, 'es');
    await repo.recusar(ana.id, 'es');
    await repo.recusar(ana.id, 'en');

    expect((await repo.recusados(ana.id)).sort()).toEqual(['en', 'es']);
  });

  it('confirmar grava o PAR do detectado e apaga a recusa antiga do mesmo idioma', async () => {
    const { ana } = await seed();
    await repo.recusar(ana.id, 'es');
    const em = new Date('2026-09-29T12:00:00Z');

    await repo.confirmar(ana.id, 'es', em);

    const [linha] = await db.select().from(users).where(eq(users.id, ana.id));
    expect(linha.detectedLanguage).toBe('es');
    expect(linha.detectedLanguageConfirmedAt?.toISOString()).toBe(
      em.toISOString(),
    );
    expect(await repo.recusados(ana.id)).toEqual([]);
  });

  it('apagar a pessoa leva as recusas junto', async () => {
    const { bob } = await seed();
    await repo.recusar(bob.id, 'es');

    await db.execute(sql`DELETE FROM users WHERE id = ${bob.id}`);

    expect(await db.select().from(detectedLanguageDeclines)).toEqual([]);
  });
});
