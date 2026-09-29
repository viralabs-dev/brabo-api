import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../../support/test-db';
import { projects, sessions, users, workspaces } from '../../../src/db/schema';
import { DrizzleSessionLanguageOverrideRepository } from '../../../src/infrastructure/persistence/drizzle/session-language-override.repository';
import { DrizzleUserRepository } from '../../../src/infrastructure/persistence/drizzle/user.repository';

const { db, pool } = createTestDb();
const overrides = new DrizzleSessionLanguageOverrideRepository(db);
const usuarios = new DrizzleUserRepository(db);

/**
 * O idioma das respostas no BANCO de verdade (RN-618, ADR 0177): a chave do
 * override é o PAR sessão×usuário, e o detectado só existe confirmado.
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
  const [session] = await db
    .insert(sessions)
    .values({ projectId: project.id, createdBy: ana.id })
    .returning();
  return { ana, bob, session };
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('users — idioma das respostas (RN-618)', () => {
  it('conta nova nasce automático (NULL) e sem detectado', async () => {
    const { ana } = await seed();

    expect(ana.responseLanguage).toBeNull();
    expect(ana.detectedLanguage).toBeNull();
    expect(ana.detectedLanguageConfirmedAt).toBeNull();
  });

  it('updateResponseLanguage grava e volta ao automático sem tocar o locale', async () => {
    const { ana } = await seed();

    const escolhido = await usuarios.updateResponseLanguage(ana.id, 'es');
    expect(escolhido.responseLanguage).toBe('es');
    expect(escolhido.locale).toBe('pt-BR');

    const automatico = await usuarios.updateResponseLanguage(ana.id, null);
    expect(automatico.responseLanguage).toBeNull();
  });

  it('o CHECK recusa idioma detectado sem instante de confirmação', async () => {
    const { ana } = await seed();

    await expect(
      db.execute(
        sql`UPDATE users SET detected_language = 'en' WHERE id = ${ana.id}`,
      ),
    ).rejects.toMatchObject({
      cause: { constraint: 'users_idioma_detectado_so_confirmado' },
    });
  });
});

describe('DrizzleSessionLanguageOverrideRepository (RN-618)', () => {
  it('sem linha é null — o estado normal', async () => {
    const { ana, session } = await seed();

    expect(await overrides.find(session.id, ana.id)).toBeNull();
  });

  it('set é upsert pelo par, e cada participante tem o seu', async () => {
    const { ana, bob, session } = await seed();

    await overrides.set(session.id, ana.id, 'fr');
    await overrides.set(session.id, ana.id, 'de');
    await overrides.set(session.id, bob.id, 'en');

    expect(await overrides.find(session.id, ana.id)).toBe('de');
    expect(await overrides.find(session.id, bob.id)).toBe('en');
  });

  it('clear apaga só o da pessoa e é idempotente', async () => {
    const { ana, bob, session } = await seed();
    await overrides.set(session.id, ana.id, 'fr');
    await overrides.set(session.id, bob.id, 'en');

    await overrides.clear(session.id, ana.id);
    await overrides.clear(session.id, ana.id);

    expect(await overrides.find(session.id, ana.id)).toBeNull();
    expect(await overrides.find(session.id, bob.id)).toBe('en');
  });

  it('apagar a sessão leva os overrides junto', async () => {
    const { ana, session } = await seed();
    await overrides.set(session.id, ana.id, 'fr');

    await db.execute(sql`DELETE FROM sessions WHERE id = ${session.id}`);

    expect(await overrides.find(session.id, ana.id)).toBeNull();
  });
});
