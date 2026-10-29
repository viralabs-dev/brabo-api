import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { users, workspaces } from '../../../../src/db/schema';
import { DrizzleUserCredentialRepository } from '../../../../src/infrastructure/persistence/drizzle/user-credential.repository';
import { DrizzleWorkspaceRepository } from '../../../../src/infrastructure/persistence/drizzle/workspace.repository';
import { EnvelopeEncryptionService } from '../../../../src/infrastructure/security/envelope-encryption.service';
import { UpsertUserCredentialUseCase } from '../../../../src/application/use-cases/llm/upsert-user-credential.use-case';
import { ListCredentialedProvidersUseCase } from '../../../../src/application/use-cases/llm/list-credentialed-providers.use-case';

const { db, pool } = createTestDb();
const credentialRepo = new DrizzleUserCredentialRepository(db);
const upsert = new UpsertUserCredentialUseCase(
  credentialRepo,
  new EnvelopeEncryptionService(),
);
const useCase = new ListCredentialedProvidersUseCase(
  credentialRepo,
  new DrizzleWorkspaceRepository(db),
);

async function setup() {
  const [titular, outro] = await db
    .insert(users)
    .values([
      { keycloakSub: 'sub-tit', email: 'tit@brabo.dev' },
      { keycloakSub: 'sub-out', email: 'out@brabo.dev' },
    ])
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'Acme', slug: 'acme-cred', createdBy: titular.id })
    .returning();
  return { titular, outro, ws };
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('ListCredentialedProvidersUseCase', () => {
  it('titular com duas chaves: só os dois nomes, em ordem estável, sem token de git', async () => {
    const { titular, ws } = await setup();
    await upsert.execute(titular.id, 'openrouter', 'sk-or-segredo');
    await upsert.execute(titular.id, 'anthropic', 'sk-ant-segredo');
    await upsert.execute(titular.id, 'github', 'ghp_segredo');
    const r = await useCase.execute(ws.id);
    expect(r).toEqual({ providers: ['anthropic', 'openrouter'] });
    expect(JSON.stringify(r)).not.toContain('segredo');
  });

  it('titular sem credencial: vazio, e a chave de OUTRO membro não conta', async () => {
    const { outro, ws } = await setup();
    await upsert.execute(outro.id, 'openai', 'sk-segredo');
    expect(await useCase.execute(ws.id)).toEqual({ providers: [] });
  });
});
