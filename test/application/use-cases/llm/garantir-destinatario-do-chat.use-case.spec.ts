import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ulid } from 'ulid';
import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  projects,
  sessionEvents,
  sessions,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleSessionRepository } from '../../../../src/infrastructure/persistence/drizzle/session.repository';
import { DrizzleSessionEventRepository } from '../../../../src/infrastructure/persistence/drizzle/session-event.repository';
import { GarantirDestinatarioDoChatUseCase } from '../../../../src/application/use-cases/llm/garantir-destinatario-do-chat.use-case';
import { chatSemDestinatarioRecusado } from '../../../../src/domain/sessions/chat-sem-destinatario';

/**
 * RN-682 (AT-254): a consultiva sem agente não manda a mensagem ao modelo cru
 * — a rota de chat recusa, nomeando, antes de qualquer efeito.
 */
const { db, pool } = createTestDb();
const garantir = new GarantirDestinatarioDoChatUseCase(
  new DrizzleSessionRepository(db),
  new DrizzleSessionEventRepository(db),
);

async function sessao(kind: 'consultiva' | 'criativa') {
  const [owner] = await db
    .insert(users)
    .values({ keycloakSub: `sub-${ulid()}`, email: `${ulid()}@brabo.dev` })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: 'acme',
      slug: `acme-${ulid()}`.toLowerCase(),
      createdBy: owner.id,
    })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: 'core',
      slug: 'core',
      createdBy: owner.id,
    })
    .returning();
  const [s] = await db
    .insert(sessions)
    .values({
      projectId: project.id,
      createdBy: owner.id,
      kind,
      status: 'active',
    })
    .returning();
  return { projectId: project.id, sessionId: s.id };
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('chatSemDestinatarioRecusado (RN-682)', () => {
  it('recusa só a consultiva sem agente', () => {
    expect(chatSemDestinatarioRecusado('consultiva', false)).toBe(true);
    expect(chatSemDestinatarioRecusado('consultiva', true)).toBe(false);
    expect(chatSemDestinatarioRecusado('criativa', false)).toBe(false);
  });
});

describe('GarantirDestinatarioDoChatUseCase (RN-682)', () => {
  it('consultiva sem agente: 422 `destinatario_ausente`, sem gravar nada', async () => {
    const { projectId, sessionId } = await sessao('consultiva');

    const erro = await garantir
      .execute(projectId, sessionId)
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(UnprocessableEntityException);
    expect((erro as UnprocessableEntityException).getResponse()).toMatchObject({
      reason: 'destinatario_ausente',
    });
    expect(await db.select().from(sessionEvents)).toHaveLength(0);
  });

  it('consultiva COM agente ativado: passa', async () => {
    const { projectId, sessionId } = await sessao('consultiva');
    await db.insert(sessionEvents).values({
      id: ulid(),
      sessionId,
      seq: 1,
      type: 'agent.activated',
      actorKind: 'user',
      actorId: 'u1',
      payload: { agent: 'staff' },
    });

    await expect(
      garantir.execute(projectId, sessionId),
    ).resolves.toBeUndefined();
  });

  it('criativa sem agente: passa (a regra é da consultiva)', async () => {
    const { projectId, sessionId } = await sessao('criativa');
    await expect(
      garantir.execute(projectId, sessionId),
    ).resolves.toBeUndefined();
  });

  it('sessão de outro projeto: 404, como antes', async () => {
    const { sessionId } = await sessao('consultiva');
    await expect(
      garantir.execute(randomUUID(), sessionId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
