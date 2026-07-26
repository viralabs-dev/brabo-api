import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { ulid } from 'ulid';
import { createTestDb, truncateAll } from '../../support/test-db';
import {
  projects,
  sessions,
  users,
  workspaces,
} from '../../../src/db/schema';
import { DrizzleSessionEventRepository } from '../../../src/infrastructure/persistence/drizzle/session-event.repository';

const { db, pool } = createTestDb();
const repo = new DrizzleSessionEventRepository(db);

async function seedSession(): Promise<string> {
  const [owner] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-ev', email: 'ev@brabo.dev' })
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
  const [session] = await db
    .insert(sessions)
    .values({ projectId: project.id, createdBy: owner.id })
    .returning();
  return session.id;
}

async function seedEvents(sessionId: string, total: number) {
  for (let seq = 1; seq <= total; seq++) {
    await repo.append({
      id: ulid(),
      sessionId,
      seq,
      type: `evento.${seq}`,
      actor: { kind: 'agent', id: 'dev-core' },
      payload: {},
    });
  }
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('DrizzleSessionEventRepository.listPaginated — latest (Fase 4a)', () => {
  it('sem `latest`, devolve os PRIMEIROS — o comportamento que congelava o painel', async () => {
    const sessionId = await seedSession();
    await seedEvents(sessionId, 10);

    const page = await repo.listPaginated(sessionId, { limit: 3 });

    expect(page.items.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('com `latest`, devolve os ÚLTIMOS, ainda em ordem crescente', async () => {
    // O painel do time, a seção de execução e o feed derivam estado ATUAL:
    // com os primeiros N tudo congelava no começo da sessão assim que ela
    // passava do limite (ver ADR 0021).
    const sessionId = await seedSession();
    await seedEvents(sessionId, 10);

    const page = await repo.listPaginated(sessionId, { limit: 3, latest: true });

    expect(page.items.map((e) => e.seq)).toEqual([8, 9, 10]);
  });

  it('`latest` não promete próxima página — não existe nada mais recente', async () => {
    const sessionId = await seedSession();
    await seedEvents(sessionId, 10);

    const page = await repo.listPaginated(sessionId, { limit: 3, latest: true });

    expect(page.nextCursor).toBeNull();
  });

  it('sessão menor que o limite devolve tudo, com ou sem `latest`', async () => {
    const sessionId = await seedSession();
    await seedEvents(sessionId, 2);

    const comLatest = await repo.listPaginated(sessionId, {
      limit: 50,
      latest: true,
    });
    const semLatest = await repo.listPaginated(sessionId, { limit: 50 });

    expect(comLatest.items.map((e) => e.seq)).toEqual([1, 2]);
    expect(semLatest.items.map((e) => e.seq)).toEqual([1, 2]);
  });
});
