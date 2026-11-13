import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../support/test-db';
import { projects, users, workspaces } from '../../src/db/schema';
import { marcarProjetoDeTeste } from '../../src/scripts/marcar-projeto-de-teste';
import { DrizzleProjectRepository } from '../../src/infrastructure/persistence/drizzle/project.repository';

// RN-1076 (AT-898): o script de operador liga projects.sessao_de_teste, e o
// repositório lê de volta o que o contexto do Psicólogo devolve.
const { db, pool } = createTestDb();

async function semearProjeto(): Promise<string> {
  const [dono] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-teste', email: 'teste@brabo.dev' })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: dono.id })
    .returning();
  const [projeto] = await db
    .insert(projects)
    .values({
      workspaceId: ws.id,
      name: 'core',
      slug: 'core',
      createdBy: dono.id,
    })
    .returning();
  return projeto.id;
}

describe('marcarProjetoDeTeste', () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('projeto novo nasce desmarcado e o script o liga (idempotente)', async () => {
    const id = await semearProjeto();
    const repo = new DrizzleProjectRepository(db);
    expect(await repo.isSessaoDeTeste(id)).toBe(false);

    expect(await marcarProjetoDeTeste(db, id)).toBe(true);
    expect(await marcarProjetoDeTeste(db, id)).toBe(true);

    expect(await repo.isSessaoDeTeste(id)).toBe(true);
    const [linha] = await db.select().from(projects).where(eq(projects.id, id));
    expect(linha.sessaoDeTeste).toBe(true);
  });

  it('projeto inexistente: devolve false e nada muda', async () => {
    expect(
      await marcarProjetoDeTeste(db, '00000000-0000-4000-8000-000000000000'),
    ).toBe(false);
  });
});
