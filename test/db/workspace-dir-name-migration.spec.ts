import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, truncateAll } from '../support/test-db';
import { projects, users, workspaces } from '../../src/db/schema';

/**
 * A migração 0042 — nome de pasta legível (RN-109).
 *
 * `workspace_dir_name` é NOT NULL + UNIQUE desde esta migração, mas quase
 * nenhum chamador de teste no repo sabe (nem precisa saber) desse conceito —
 * são 50+ arquivos que inserem `projects` direto, sem essa coluna. Reescrever
 * todos não provaria nada a mais sobre a FEATURE; o que prova é o TRIGGER que
 * os protege: `projects_workspace_dir_name_default_trg` grava `id::text`
 * quando ninguém grava nada, exatamente o valor que o backfill da mesma
 * migração usou para as linhas que já existiam. As duas coisas são o MESMO
 * fallback — testar uma é testar o mecanismo que sustenta a outra.
 */
const { db, pool } = createTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

async function workspace(slugSufixo: string) {
  const [owner] = await db
    .insert(users)
    .values({
      keycloakSub: `sub-wdn-${slugSufixo}`,
      email: `wdn-${slugSufixo}@brabo.dev`,
    })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({
      name: `wdn-${slugSufixo}`,
      slug: `wdn-${slugSufixo}`,
      createdBy: owner.id,
    })
    .returning();
  return { ownerId: owner.id, workspaceId: ws.id };
}

describe('migração 0042 — workspace_dir_name (RN-109)', () => {
  it('insert sem workspace_dir_name recebe o id — o mesmo fallback do backfill', async () => {
    const { ownerId, workspaceId } = await workspace('sem-nome');

    const [projeto] = await db
      .insert(projects)
      .values({
        workspaceId,
        name: 'sem nome',
        slug: 'sem-nome',
        createdBy: ownerId,
      })
      .returning();

    expect(projeto.workspaceDirName).toBe(projeto.id);
  });

  it('insert com workspace_dir_name explícito não é sobrescrito pelo trigger', async () => {
    const { ownerId, workspaceId } = await workspace('com-nome');

    const [projeto] = await db
      .insert(projects)
      .values({
        workspaceId,
        name: 'com nome',
        slug: 'com-nome',
        createdBy: ownerId,
        workspaceDirName: 'com-nome-abcd1234',
      })
      .returning();

    expect(projeto.workspaceDirName).toBe('com-nome-abcd1234');
  });

  it('dois projetos não podem ter o mesmo workspace_dir_name — defesa em profundidade', async () => {
    const { ownerId, workspaceId } = await workspace('duplicado');

    await db.insert(projects).values({
      workspaceId,
      name: 'a',
      slug: 'a',
      createdBy: ownerId,
      workspaceDirName: 'pasta-repetida',
    });

    await expect(
      db.insert(projects).values({
        workspaceId,
        name: 'b',
        slug: 'b',
        createdBy: ownerId,
        workspaceDirName: 'pasta-repetida',
      }),
    ).rejects.toThrow();
  });
});
