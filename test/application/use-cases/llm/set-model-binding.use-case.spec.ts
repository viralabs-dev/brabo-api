import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { models, users } from '../../../../src/db/schema';
import { DrizzleModelBindingRepository } from '../../../../src/infrastructure/persistence/drizzle/model-binding.repository';
import { DrizzleModelRepository } from '../../../../src/infrastructure/persistence/drizzle/model.repository';
import { SetModelBindingUseCase } from '../../../../src/application/use-cases/llm/set-model-binding.use-case';
import { ModelNotFitForAgentScopeError } from '../../../../src/domain/llm/model-capabilities';

const { db, pool } = createTestDb();
const useCase = new SetModelBindingUseCase(
  new DrizzleModelBindingRepository(db),
  new DrizzleModelRepository(db),
);

async function setup() {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-set-binding', email: 'bind@brabo.dev' })
    .returning();

  const [comFerramentas] = await db
    .insert(models)
    .values({
      provider: 'openai',
      name: 'gpt-4o-mini',
      displayName: 'GPT-4o mini',
      supportsToolCalling: true,
    })
    .returning();

  const [chatOnly] = await db
    .insert(models)
    .values({
      provider: 'ollama',
      name: 'tagarela:1b',
      displayName: 'Tagarela 1B',
      // Sem passar nada: o default da coluna é `false`, e é justamente esse
      // default que protege modelo descoberto por sync na Fase 9c.
    })
    .returning();

  return { user, comFerramentas, chatOnly };
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('SetModelBindingUseCase', () => {
  it('vincula um modelo com tool calling a um agente', async () => {
    const { user, comFerramentas } = await setup();

    const binding = await useCase.execute(
      'agent',
      'dev-backend',
      comFerramentas.id,
      user.id,
    );

    expect(binding).toMatchObject({
      scope: 'agent',
      scopeId: 'dev-backend',
      modelId: comFerramentas.id,
    });
  });

  it('recusa modelo chat-only no escopo agent (RN-038)', async () => {
    const { user, chatOnly } = await setup();

    await expect(
      useCase.execute('agent', 'dev-backend', chatOnly.id, user.id),
    ).rejects.toThrow(ModelNotFitForAgentScopeError);
  });

  it('não grava nada quando recusa', async () => {
    const { user, chatOnly } = await setup();

    await expect(
      useCase.execute('agent', 'qa', chatOnly.id, user.id),
    ).rejects.toThrow(ModelNotFitForAgentScopeError);

    const bindings = await new DrizzleModelBindingRepository(db).findOne(
      'agent',
      'qa',
    );
    expect(bindings).toBeNull();
  });

  it('aceita o mesmo modelo chat-only no escopo workspace', async () => {
    const { user, chatOnly } = await setup();

    await expect(
      useCase.execute('workspace', 'ws-1', chatOnly.id, user.id),
    ).resolves.toMatchObject({ scope: 'workspace' });
  });

  it('modelo inexistente continua sendo 404', async () => {
    const { user } = await setup();

    await expect(
      useCase.execute(
        'agent',
        'qa',
        '00000000-0000-0000-0000-000000000000',
        user.id,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
