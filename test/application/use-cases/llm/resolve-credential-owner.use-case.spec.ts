import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { projects, users, workspaces } from '../../../../src/db/schema';
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';
import { DrizzleWorkspaceRepository } from '../../../../src/infrastructure/persistence/drizzle/workspace.repository';
import { DrizzleUserCredentialRepository } from '../../../../src/infrastructure/persistence/drizzle/user-credential.repository';
import { EnvelopeEncryptionService } from '../../../../src/infrastructure/security/envelope-encryption.service';
import { ResolveCredentialOwnerUseCase } from '../../../../src/application/use-cases/llm/resolve-credential-owner.use-case';

const { db, pool } = createTestDb();
const useCase = new ResolveCredentialOwnerUseCase(
  new DrizzleProjectRepository(db),
  new DrizzleWorkspaceRepository(db),
);
const credentialRepo = new DrizzleUserCredentialRepository(db);
const encryption = new EnvelopeEncryptionService();

/**
 * De quem é a chave que um agente gasta.
 *
 * O turno de agente passava o SLUG (`agentId ?? sessionId`) na coluna
 * `user_credentials.user_id`, que é UUID. A consulta ia ao banco com
 * `user_id = 'criativo'`, o Postgres recusava, e o erro virava resposta VAZIA
 * no fio — sem métrica, sem evento de falha, sem nada na tela. O efeito, que
 * só uma execução real revelou: **nenhum agente conseguia usar provider com
 * credencial**; só `ollama`, para quem a busca é pulada.
 */
async function setup() {
  const [dono] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-dono', email: 'dono@brabo.dev' })
    .returning();
  const [outro] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-outro', email: 'outro@brabo.dev' })
    .returning();

  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'Acme', slug: 'acme-cred', createdBy: dono.id })
    .returning();

  const [projeto] = await db
    .insert(projects)
    .values({
      workspaceId: ws.id,
      name: 'Projeto',
      slug: 'projeto-cred',
      // Quem CRIOU o projeto não é o dono do workspace — é a distinção que
      // este caso de uso existe para fazer.
      createdBy: outro.id,
    })
    .returning();

  return { dono, outro, ws, projeto };
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('ResolveCredentialOwnerUseCase', () => {
  it('devolve o owner do WORKSPACE, não quem criou o projeto', async () => {
    const { dono, outro, projeto } = await setup();

    const resolvido = await useCase.execute(projeto.id);

    expect(resolvido).toBe(dono.id);
    expect(resolvido).not.toBe(outro.id);
  });

  /**
   * O teste que amarra a regra ao efeito: é a chave DO OWNER que a busca
   * encontra. Com o slug do agente ali, esta consulta nem chegava a rodar.
   */
  it('a chave encontrada é a do owner, e o slug do agente não acha nada', async () => {
    const { dono, projeto } = await setup();
    await credentialRepo.upsert(
      dono.id,
      'openrouter',
      encryption.encrypt('sk-or-v1-do-dono'),
    );

    const resolvido = await useCase.execute(projeto.id);
    const segredo = await credentialRepo.findSecretByUserAndProvider(
      resolvido,
      'openrouter',
    );

    expect(segredo).not.toBeNull();
    expect(encryption.decrypt(segredo!)).toBe('sk-or-v1-do-dono');
  });

  it('projeto inexistente falha com 404, não com erro de banco', async () => {
    await expect(
      useCase.execute('00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow(NotFoundException);
  });
});
