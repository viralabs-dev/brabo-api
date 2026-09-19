import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, truncateAll } from '../../support/test-db';
import {
  projects,
  sessions,
  users,
  workspaces,
} from '../../../src/db/schema';
import { DrizzleHandoffRepository } from '../../../src/infrastructure/persistence/drizzle/handoff.repository';

/**
 * `findByProject` — a leitura que a recusa de `execution/activate` sem
 * repositório usa para dizer QUAL handoff falta aceitar (RN-582). O handoff ao
 * Arquiteto mora na sessão do PO e o do Dev Lead na do Arquiteto (ou na
 * mesma), então a leitura tem de atravessar sessões — e nunca atravessar
 * projetos.
 */
const { db, pool } = createTestDb();
const repo = new DrizzleHandoffRepository(db);

async function seed() {
  const [owner] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-hp', email: 'hp@brabo.dev' })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: owner.id })
    .returning();
  const novoProjeto = async (slug: string) => {
    const [p] = await db
      .insert(projects)
      .values({ workspaceId: ws.id, name: slug, slug, createdBy: owner.id })
      .returning();
    return p.id;
  };
  const novaSessao = async (projectId: string) => {
    const [s] = await db
      .insert(sessions)
      .values({ projectId, createdBy: owner.id })
      .returning();
    return s.id;
  };
  return { novoProjeto, novaSessao };
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('DrizzleHandoffRepository.findByProject (RN-582)', () => {
  it('traz os handoffs de TODAS as sessões do projeto, em ordem de criação', async () => {
    const { novoProjeto, novaSessao } = await seed();
    const p = await novoProjeto('loja');
    const sPo = await novaSessao(p);
    const sArq = await novaSessao(p);

    await repo.create({ sessionId: sPo, projectId: p, fromAgent: 'po', toAgent: 'arquiteto' });
    await repo.create({ sessionId: sArq, projectId: p, fromAgent: 'arquiteto', toAgent: 'dev-lead' });

    const lidos = await repo.findByProject(p);
    expect(lidos.map((h) => h.toAgent)).toEqual(['arquiteto', 'dev-lead']);
  });

  it('nunca traz handoff de OUTRO projeto', async () => {
    const { novoProjeto, novaSessao } = await seed();
    const a = await novoProjeto('a');
    const b = await novoProjeto('b');
    await repo.create({
      sessionId: await novaSessao(b),
      projectId: b,
      fromAgent: 'po',
      toAgent: 'arquiteto',
    });

    expect(await repo.findByProject(a)).toEqual([]);
  });
});
