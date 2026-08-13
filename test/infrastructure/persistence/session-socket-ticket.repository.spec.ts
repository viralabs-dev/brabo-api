import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../../support/test-db';
import {
  projects,
  sessions,
  sessionSocketTickets,
  users,
  workspaces,
} from '../../../src/db/schema';
import { DrizzleSessionSocketTicketRepository } from '../../../src/infrastructure/persistence/drizzle/session-socket-ticket.repository';

const { db, pool } = createTestDb();
const repo = new DrizzleSessionSocketTicketRepository(db);

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

async function seedProjetoESessao() {
  const [owner] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-ticket', email: 'ticket@brabo.dev' })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: owner.id })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({ workspaceId: ws.id, name: 'core', slug: 'core', createdBy: owner.id })
    .returning();
  const [session] = await db
    .insert(sessions)
    .values({ projectId: project.id, createdBy: owner.id, status: 'active' })
    .returning();

  return { owner, project, session };
}

describe('DrizzleSessionSocketTicketRepository', () => {
  it('emitir grava a linha com o hash, nunca o token bruto (não há coluna pra ele)', async () => {
    const { owner, project, session } = await seedProjetoESessao();
    const expiresAt = new Date(Date.now() + 30_000);

    await repo.emitir({
      sessionId: session.id,
      projectId: project.id,
      userId: owner.id,
      scope: 'heartbeat',
      ticketHash: 'hash-de-teste',
      expiresAt,
    });

    const [linha] = await db
      .select()
      .from(sessionSocketTickets)
      .where(eq(sessionSocketTickets.ticketHash, 'hash-de-teste'));

    expect(linha).toBeDefined();
    expect(linha.sessionId).toBe(session.id);
    expect(linha.projectId).toBe(project.id);
    expect(linha.userId).toBe(owner.id);
    expect(linha.scope).toBe('heartbeat');
    expect(linha.consumedAt).toBeNull();
    // A tabela não tem coluna de token bruto — o schema é a prova.
    expect(Object.keys(linha)).not.toContain('ticket');
  });
});
