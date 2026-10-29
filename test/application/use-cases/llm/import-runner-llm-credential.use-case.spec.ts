import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { eq } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { userCredentials, users } from '../../../../src/db/schema';
import { DrizzleUserCredentialRepository } from '../../../../src/infrastructure/persistence/drizzle/user-credential.repository';
import { EnvelopeEncryptionService } from '../../../../src/infrastructure/security/envelope-encryption.service';
import { UpsertUserCredentialUseCase } from '../../../../src/application/use-cases/llm/upsert-user-credential.use-case';
import { ImportRunnerLlmCredentialUseCase } from '../../../../src/application/use-cases/llm/import-runner-llm-credential.use-case';
import { ImportLlmCredentialDto } from '../../../../src/interfaces/http/runner/dto/import-llm-credential.dto';

/**
 * AT-611 / RN-927 — `POST /runner/llm-credentials`. A autenticação (401/403)
 * é do `PatAuthGuard` e já é provada em `pat-auth.guard.spec.ts` (rota sem
 * `:projectId`: credencial de projeto é 403, chave revogada é 401).
 */
const { db, pool } = createTestDb();
const repo = new DrizzleUserCredentialRepository(db);
const importar = new ImportRunnerLlmCredentialUseCase(
  repo,
  new UpsertUserCredentialUseCase(repo, new EnvelopeEncryptionService()),
);
const CHAVE = 'sk-ant-IMPORTADA-0123456789-segredo';

async function usuario() {
  const [u] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-imp', email: 'imp@brabo.dev' })
    .returning();
  return u;
}

beforeEach(async () => {
  await truncateAll(db);
});
afterAll(async () => {
  await pool.end();
});

describe('ImportRunnerLlmCredentialUseCase', () => {
  it('caminho feliz: grava cifrado com key_id, sem valor no log nem na resposta', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const u = await usuario();

    const r = await importar.execute(
      u.id,
      'anthropic',
      CHAVE,
      'claude: ~/.claude.json',
      false,
    );

    expect(r).toEqual({ provider: 'anthropic', substituida: false });
    const [row] = await db
      .select()
      .from(userCredentials)
      .where(eq(userCredentials.userId, u.id));
    expect(row.keyId).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain(CHAVE);
    expect(JSON.stringify([r, log.mock.calls])).not.toContain(CHAVE);
    expect(JSON.stringify(log.mock.calls)).toContain('claude: ~/.claude.json');
    log.mockRestore();
  });

  it('409 credencial_existente sem substituir, e não toca a existente', async () => {
    const u = await usuario();
    await importar.execute(u.id, 'openai', CHAVE, 'x', false);
    const [antes] = await db
      .select()
      .from(userCredentials)
      .where(eq(userCredentials.userId, u.id));

    await expect(
      importar.execute(u.id, 'openai', 'outra-chave', 'x', false),
    ).rejects.toMatchObject({
      response: { code: 'credencial_existente' },
      status: 409,
    });
    const [depois] = await db
      .select()
      .from(userCredentials)
      .where(eq(userCredentials.userId, u.id));
    expect(depois.encryptedApiKey).toBe(antes.encryptedApiKey);
  });

  it('substituir: true troca e devolve substituida: true', async () => {
    const u = await usuario();
    await importar.execute(u.id, 'openai', CHAVE, 'x', false);
    const [antes] = await db
      .select()
      .from(userCredentials)
      .where(eq(userCredentials.userId, u.id));

    const r = await importar.execute(u.id, 'openai', 'outra-chave', 'x', true);

    expect(r).toEqual({ provider: 'openai', substituida: true });
    const [depois] = await db
      .select()
      .from(userCredentials)
      .where(eq(userCredentials.userId, u.id));
    expect(depois.encryptedApiKey).not.toBe(antes.encryptedApiKey);
  });
});

describe('ImportLlmCredentialDto', () => {
  const erros = (o: object) =>
    validate(plainToInstance(ImportLlmCredentialDto, o));

  it('aceita o corpo válido', async () => {
    expect(
      await erros({ provider: 'openai', apiKey: 'k', origem: 'codex' }),
    ).toHaveLength(0);
  });
  it('400: provider fora do enum (ollama não tem credencial)', async () => {
    expect(
      await erros({ provider: 'ollama', apiKey: 'k', origem: 'x' }),
    ).not.toHaveLength(0);
    expect(
      await erros({ provider: 'nada', apiKey: 'k', origem: 'x' }),
    ).not.toHaveLength(0);
  });
});
