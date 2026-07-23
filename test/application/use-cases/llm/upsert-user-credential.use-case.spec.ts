import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { userCredentials, users } from '../../../../src/db/schema';
import { DrizzleUserCredentialRepository } from '../../../../src/infrastructure/persistence/drizzle/user-credential.repository';
import { EnvelopeEncryptionService } from '../../../../src/infrastructure/security/envelope-encryption.service';
import { UpsertUserCredentialUseCase } from '../../../../src/application/use-cases/llm/upsert-user-credential.use-case';
import { ListUserCredentialsUseCase } from '../../../../src/application/use-cases/llm/list-user-credentials.use-case';

const { db, pool } = createTestDb();
const credentialRepo = new DrizzleUserCredentialRepository(db);
const encryption = new EnvelopeEncryptionService();
const upsertCredential = new UpsertUserCredentialUseCase(
  credentialRepo,
  encryption,
);
const listCredentials = new ListUserCredentialsUseCase(credentialRepo);

const PLAINTEXT_KEY = 'sk-ant-abcdef0123456789-super-secret';

async function setupUser() {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-cred', email: 'cred@brabo.dev' })
    .returning();
  return user;
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('UpsertUserCredentialUseCase', () => {
  it('caminho feliz: a linha no banco nunca contém o texto plano', async () => {
    const user = await setupUser();
    await upsertCredential.execute(user.id, 'anthropic', PLAINTEXT_KEY);

    const [row] = await db
      .select()
      .from(userCredentials)
      .where(eq(userCredentials.userId, user.id));

    expect(JSON.stringify(row)).not.toContain(PLAINTEXT_KEY);
    expect(row.encryptedApiKey).not.toBe(PLAINTEXT_KEY);
  });

  it('listagem de credenciais nunca inclui o segredo', async () => {
    const user = await setupUser();
    await upsertCredential.execute(user.id, 'anthropic', PLAINTEXT_KEY);

    const list = await listCredentials.execute(user.id);
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(PLAINTEXT_KEY);
    expect(typeof list[0].id).toBe('string');
    expect(list[0].provider).toBe('anthropic');
    expect(list[0].createdAt).toBeInstanceOf(Date);
    expect(list[0].updatedAt).toBeInstanceOf(Date);
  });

  it('falha: ciphertext adulterado no banco falha ao decriptar', async () => {
    const user = await setupUser();
    await upsertCredential.execute(user.id, 'anthropic', PLAINTEXT_KEY);

    const secret = await credentialRepo.findSecretByUserAndProvider(
      user.id,
      'anthropic',
    );
    const tamperedBuffer = Buffer.from(secret!.encryptedApiKey, 'base64');
    tamperedBuffer[0] ^= 0xff;

    expect(() =>
      encryption.decrypt({
        ...secret!,
        encryptedApiKey: tamperedBuffer.toString('base64'),
      }),
    ).toThrow();
  });

  it('upsert é idempotente por (userId, provider) — segunda chamada substitui a primeira', async () => {
    const user = await setupUser();
    await upsertCredential.execute(user.id, 'anthropic', 'primeira-chave');
    await upsertCredential.execute(user.id, 'anthropic', 'segunda-chave');

    const secret = await credentialRepo.findSecretByUserAndProvider(
      user.id,
      'anthropic',
    );
    expect(encryption.decrypt(secret!)).toBe('segunda-chave');

    const list = await listCredentials.execute(user.id);
    expect(list).toHaveLength(1);
  });
});
