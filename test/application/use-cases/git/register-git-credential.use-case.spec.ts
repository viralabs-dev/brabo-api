import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { userCredentials, users } from '../../../../src/db/schema';
import { DrizzleUserCredentialRepository } from '../../../../src/infrastructure/persistence/drizzle/user-credential.repository';
import { EnvelopeEncryptionService } from '../../../../src/infrastructure/security/envelope-encryption.service';
import { RegisterGitCredentialUseCase } from '../../../../src/application/use-cases/git/register-git-credential.use-case';

const { db, pool } = createTestDb();
const credentialRepo = new DrizzleUserCredentialRepository(db);
const encryption = new EnvelopeEncryptionService();
const useCase = new RegisterGitCredentialUseCase(credentialRepo, encryption);

const PLAINTEXT_TOKEN = 'ghp_super_secret_token_0123456789';

async function setupUser() {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-git-cred', email: 'git-cred@brabo.dev' })
    .returning();
  return user;
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('RegisterGitCredentialUseCase', () => {
  it('caminho feliz: cifra e persiste, nunca grava o texto plano', async () => {
    const user = await setupUser();

    const metadata = await useCase.execute(user.id, 'github', PLAINTEXT_TOKEN);
    expect(metadata.provider).toBe('github');

    const [row] = await db
      .select()
      .from(userCredentials)
      .where(eq(userCredentials.userId, user.id));
    expect(row).toBeDefined();
    expect(JSON.stringify(row)).not.toContain(PLAINTEXT_TOKEN);
  });

  /**
   * A INVERSÃO do ADR 0050, escrita como teste.
   *
   * Até aqui este caso afirmava o contrário: token recusado no teste de
   * conexão não podia deixar rastro. O modo de falha real foi o oposto do
   * previsto — sem gravar nada, o usuário ficava sem token E sem diagnóstico,
   * porque a tela nunca reexibe o que ele digitou. Guardar passou a ser
   * incondicional; verificar é `TestStoredCredentialUseCase`.
   */
  it('token que o provider recusaria é gravado do mesmo jeito — o cadastro não julga', async () => {
    const user = await setupUser();

    await useCase.execute(user.id, 'github', 'token-que-nao-vale-nada');

    const rows = await db
      .select()
      .from(userCredentials)
      .where(eq(userCredentials.userId, user.id));
    expect(rows).toHaveLength(1);

    const secret = await credentialRepo.findSecretByUserAndProvider(
      user.id,
      'github',
    );
    expect(encryption.decrypt(secret!)).toBe('token-que-nao-vale-nada');
  });
});
