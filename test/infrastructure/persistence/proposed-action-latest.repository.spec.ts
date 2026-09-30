import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, truncateAll } from '../../support/test-db';
import { projects, sessions, users, workspaces } from '../../../src/db/schema';
import { DrizzleProposedActionRepository } from '../../../src/infrastructure/persistence/drizzle/proposed-action.repository';
import type { ActionStatus } from '../../../src/domain/actions/action-state-machine';

/**
 * AT-296, RN-637 — a pendente nova de uma sessão com mais de 200 ações.
 *
 * A listagem por sessão ordenava por `seq` crescente com teto de 200, e a
 * tela nunca paginava: a partir da ação 201 a pendente NOVA ficava fora da
 * única página lida e sumia do fio, dos Executores e de Aprovações.
 */
const { db, pool } = createTestDb();
const repo = new DrizzleProposedActionRepository(db);

async function seedSession(): Promise<{
  projectId: string;
  sessionId: string;
}> {
  const [owner] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-acoes', email: 'acoes@brabo.dev' })
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
  return { projectId: project.id, sessionId: session.id };
}

async function seedActions(
  alvo: { projectId: string; sessionId: string },
  statuses: ActionStatus[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const [i, status] of statuses.entries()) {
    const acao = await repo.create({
      projectId: alvo.projectId,
      sessionId: alvo.sessionId,
      actionType: 'terminal',
      payload: { command: `echo ${i}` },
      status,
      resolvedPolicy:
        status === 'pending' ? 'require_approval' : 'auto_approve',
      actor: { kind: 'agent', id: 'dev-core' },
    });
    ids.push(acao.id);
  }
  return ids;
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('DrizzleProposedActionRepository.listPaginated — cauda e pendentes (AT-296)', () => {
  it('sem `latest`, a primeira página é o COMEÇO — a pendente nova fica de fora (o defeito)', async () => {
    const alvo = await seedSession();
    const ids = await seedActions(alvo, [
      ...Array<ActionStatus>(5).fill('executed'),
      'pending',
    ]);

    const page = await repo.listPaginated(alvo.sessionId, { limit: 5 });

    expect(page.items.map((a) => a.id)).not.toContain(ids[5]);
    expect(page.nextCursor).not.toBeNull();
  });

  it('com `latest`, traz a CAUDA em ordem crescente, e a pendente nova está nela', async () => {
    const alvo = await seedSession();
    const ids = await seedActions(alvo, [
      ...Array<ActionStatus>(5).fill('executed'),
      'pending',
    ]);

    const page = await repo.listPaginated(alvo.sessionId, {
      limit: 3,
      latest: true,
    });

    expect(page.items.map((a) => a.id)).toEqual(ids.slice(3));
    const seqs = page.items.map((a) => a.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    expect(page.nextCursor).toBeNull();
  });

  it('`status=pending` devolve a pendente ANTIGA que a cauda sozinha perderia', async () => {
    const alvo = await seedSession();
    const ids = await seedActions(alvo, [
      'pending',
      ...Array<ActionStatus>(6).fill('executed'),
      'pending',
    ]);

    const cauda = await repo.listPaginated(alvo.sessionId, {
      limit: 3,
      latest: true,
    });
    expect(cauda.items.map((a) => a.id)).not.toContain(ids[0]);

    const pendentes = await repo.listPaginated(alvo.sessionId, {
      limit: 3,
      latest: true,
      status: 'pending',
    });
    expect(pendentes.items.map((a) => a.id)).toEqual([ids[0], ids[7]]);
    expect(pendentes.items.every((a) => a.status === 'pending')).toBe(true);
  });

  it('`status=pending` não traz ação de OUTRA sessão', async () => {
    const alvo = await seedSession();
    const [outra] = await db
      .insert(sessions)
      .values({
        projectId: alvo.projectId,
        createdBy: (await db.select().from(users))[0].id,
      })
      .returning();
    await seedActions({ projectId: alvo.projectId, sessionId: outra.id }, [
      'pending',
    ]);
    const ids = await seedActions(alvo, ['pending']);

    const page = await repo.listPaginated(alvo.sessionId, {
      latest: true,
      status: 'pending',
    });

    expect(page.items.map((a) => a.id)).toEqual(ids);
  });
});
