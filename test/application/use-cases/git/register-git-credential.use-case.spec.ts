import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { userCredentials, users } from '../../../../src/db/schema';
import { DrizzleUserCredentialRepository } from '../../../../src/infrastructure/persistence/drizzle/user-credential.repository';
import { EnvelopeEncryptionService } from '../../../../src/infrastructure/security/envelope-encryption.service';
import { GitCredentialConnectionTester } from '../../../../src/application/ports/git-credential-connection-tester.port';
import { GitCredentialConnectionTestFailedError } from '../../../../src/domain/git/git-errors';
import { RegisterGitCredentialUseCase } from '../../../../src/application/use-cases/git/register-git-credential.use-case';

const { db, pool } = createTestDb();
const credentialRepo = new DrizzleUserCredentialRepository(db);
const encryption = new EnvelopeEncryptionService();

class FakeConnectionTester implements GitCredentialConnectionTester {
  constructor(private readonly shouldFail: boolean) {}

  test(): Promise<void> {
    if (this.shouldFail) {
      return Promise.reject(
        new GitCredentialConnectionTestFailedError(
          'github',
          'token inválido (simulado)',
        ),
      );
    }
    return Promise.resolve();
  }
}

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
  it('caminho feliz: testa a conexão antes de persistir, nunca grava o texto plano', async () => {
    const user = await setupUser();
    const useCase = new RegisterGitCredentialUseCase(
      credentialRepo,
      encryption,
      new FakeConnectionTester(false),
    );

    const metadata = await useCase.execute(user.id, 'github', PLAINTEXT_TOKEN);
    expect(metadata.provider).toBe('github');

    const [row] = await db
      .select()
      .from(userCredentials)
      .where(eq(userCredentials.userId, user.id));
    expect(row).toBeDefined();
    expect(JSON.stringify(row)).not.toContain(PLAINTEXT_TOKEN);
  });

  it('falha: credencial inválida rejeita no teste de conexão SEM persistir nada', async () => {
    const user = await setupUser();
    const useCase = new RegisterGitCredentialUseCase(
      credentialRepo,
      encryption,
      new FakeConnectionTester(true),
    );

    await expect(
      useCase.execute(user.id, 'github', 'token-invalido'),
    ).rejects.toThrow(GitCredentialConnectionTestFailedError);

    const rows = await db
      .select()
      .from(userCredentials)
      .where(eq(userCredentials.userId, user.id));
    expect(rows).toHaveLength(0);
  });
});
