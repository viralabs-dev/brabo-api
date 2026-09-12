import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { users } from '../../../../src/db/schema';
import { DrizzleUserRepository } from '../../../../src/infrastructure/persistence/drizzle/user.repository';

/**
 * `usuarioUnicoDaInstalacao` (RN-552) — a pergunta sobre a INSTALAÇÃO que
 * decide de quem é a chave de máquina que o instalador registra, sem que
 * quem chama a rota escolha um `userId`.
 *
 * Contra o Postgres de verdade porque o que se prova é o `LIMIT 2`: com
 * `limit(1)` seria impossível distinguir "há exatamente um" de "há muitos", e
 * a rota passaria a registrar a chave para quem o planejador devolvesse
 * primeiro numa instalação com time.
 */
const { db, pool } = createTestDb();
const repo = new DrizzleUserRepository(db);

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

async function criarUsuario(sufixo: string) {
  const [user] = await db
    .insert(users)
    .values({
      keycloakSub: `sub-unico-${sufixo}`,
      email: `unico-${sufixo}@brabo.dev`,
    })
    .returning();
  return user;
}

describe('DrizzleUserRepository.usuarioUnicoDaInstalacao (RN-552)', () => {
  it('caminho feliz: com UM usuário, devolve aquele usuário', async () => {
    const unico = await criarUsuario('a');

    const encontrado = await repo.usuarioUnicoDaInstalacao();

    expect(encontrado?.id).toBe(unico.id);
  });

  it('CASO DE FALHA: com DOIS usuários, devolve `null` — nunca "o primeiro"', async () => {
    await criarUsuario('a');
    await criarUsuario('b');

    expect(await repo.usuarioUnicoDaInstalacao()).toBeNull();
  });

  it('instalação vazia: `null` também — zero e "mais de um" colapsam de propósito', async () => {
    expect(await repo.usuarioUnicoDaInstalacao()).toBeNull();
    expect(await repo.existeAlgumUsuario()).toBe(false);
  });
});
