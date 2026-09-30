import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  projects,
  sessionEvents,
  sessions,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleUnitOfWork } from '../../../../src/infrastructure/persistence/drizzle/drizzle-unit-of-work';
import { DrizzleSessionRepository } from '../../../../src/infrastructure/persistence/drizzle/session.repository';
import { DrizzleSessionEventRepository } from '../../../../src/infrastructure/persistence/drizzle/session-event.repository';
import { DrizzleOutboxRepository } from '../../../../src/infrastructure/persistence/drizzle/outbox.repository';
import { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import { ReopenSessionUseCase } from '../../../../src/application/use-cases/sessions/reopen-session.use-case';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import type { SessionStatus } from '../../../../src/domain/sessions/session-state-machine';

/**
 * ADR 0183, RN-649/RN-650 (AT-071): sessão encerrada volta a `active` com o
 * log intacto, e o fechamento anterior fica registrado num evento NOVO.
 */
const { db, pool } = createTestDb();
const sessionRepo = new DrizzleSessionRepository(db);
const eventRepo = new DrizzleSessionEventRepository(db);
const append = new AppendSessionEventUseCase(
  new DrizzleUnitOfWork(db),
  sessionRepo,
  eventRepo,
  new DrizzleOutboxRepository(db),
);

function montar(startSession = vi.fn().mockResolvedValue(undefined)) {
  const engine = { startSession } as unknown as ApiToEngineClient;
  return {
    startSession,
    reabrir: new ReopenSessionUseCase(
      new DrizzleUnitOfWork(db),
      sessionRepo,
      eventRepo,
      append,
      engine,
    ),
  };
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

const FECHOU_EM = new Date('2026-09-13T16:46:36.000Z');

async function sessaoEncerrada(
  status: SessionStatus = 'closed',
  kind: 'criativa' | 'consultiva' = 'criativa',
) {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-reopen', email: 'reopen@brabo.dev' })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: user.id })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: 'core',
      slug: 'core',
      workspaceDirName: 'core-reopen',
      createdBy: user.id,
    })
    .returning();
  const [session] = await db
    .insert(sessions)
    .values({
      projectId: project.id,
      createdBy: user.id,
      status: 'active',
      kind,
    })
    .returning();
  // O que a sessão produziu enquanto viva: uma regra de negócio e uma fala.
  await append.execute(project.id, session.id, {
    type: 'artifact.business_rule',
    actor: { kind: 'agent', id: 'criativo' },
    payload: { title: 'Regra 1' },
  });
  await append.execute(project.id, session.id, {
    type: 'chat.message',
    actor: { kind: 'user', id: user.id },
    payload: { text: 'oi' },
  });
  await db
    .update(sessions)
    .set({
      status,
      closedAt: status === 'closing' ? null : FECHOU_EM,
      terminationReason: 'heartbeat_timeout',
    })
    .where(eq(sessions.id, session.id));
  return { user, project, session };
}

async function eventosDa(sessionId: string) {
  return db
    .select()
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, sessionId))
    .orderBy(asc(sessionEvents.seq));
}

describe('ReopenSessionUseCase (RN-649)', () => {
  it('reabre `closed` para `active`, preserva o log e grava session.reopened com o fechamento anterior', async () => {
    const { user, project, session } = await sessaoEncerrada('closed');
    const { reabrir, startSession } = montar();

    const reaberta = await reabrir.execute(project.id, session.id, user.id);

    expect(reaberta.status).toBe('active');
    expect(reaberta.closedAt).toBeNull();
    expect(reaberta.terminationReason).toBeNull();
    // O `kind` não muda (RN-097).
    expect(reaberta.kind).toBe('criativa');
    expect(startSession).toHaveBeenCalledWith(session.id, project.id, null);

    const eventos = await eventosDa(session.id);
    // Nada apagado nem renumerado: os dois de antes, e o novo no seq seguinte.
    expect(eventos.map((e) => [e.seq, e.type])).toEqual([
      [1, 'artifact.business_rule'],
      [2, 'chat.message'],
      [3, 'session.reopened'],
    ]);
    expect(eventos[2].actorKind).toBe('user');
    expect(eventos[2].actorId).toBe(user.id);
    expect(eventos[2].payload).toEqual({
      from: 'closed',
      to: 'active',
      closedAt: FECHOU_EM.toISOString(),
      terminationReason: 'heartbeat_timeout',
    });
  });

  it('reabre `closed_abnormally` também', async () => {
    const { user, project, session } =
      await sessaoEncerrada('closed_abnormally');
    const { reabrir } = montar();

    const reaberta = await reabrir.execute(project.id, session.id, user.id);

    expect(reaberta.status).toBe('active');
    const [, , reopened] = await eventosDa(session.id);
    expect(reopened.payload).toMatchObject({ from: 'closed_abnormally' });
  });

  it('depois de reabrir, a conversa volta a entrar (RN-581 lê o estado novo)', async () => {
    const { user, project, session } = await sessaoEncerrada('closed');
    const { reabrir } = montar();

    // Antes: 409 sessao_encerrada.
    await expect(
      append.execute(project.id, session.id, {
        type: 'chat.message',
        actor: { kind: 'user', id: user.id },
        payload: { text: 'voltei' },
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    await reabrir.execute(project.id, session.id, user.id);

    const evento = await append.execute(project.id, session.id, {
      type: 'chat.message',
      actor: { kind: 'user', id: user.id },
      payload: { text: 'voltei' },
    });
    expect(evento.seq).toBe(4);
  });

  it('recusa `closing` com 409 nomeado, sem chamar o engine nem gravar nada', async () => {
    const { user, project, session } = await sessaoEncerrada('closing');
    const { reabrir, startSession } = montar();

    const erro = await reabrir
      .execute(project.id, session.id, user.id)
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ConflictException);
    expect((erro as ConflictException).getResponse()).toMatchObject({
      reason: 'sessao_nao_encerrada',
      status: 'closing',
    });
    expect(startSession).not.toHaveBeenCalled();
    const [linha] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, session.id));
    expect(linha.status).toBe('closing');
    expect(await eventosDa(session.id)).toHaveLength(2);
  });

  it('recusa sessão que ativou a execução, com 409 `sessao_com_execucao`', async () => {
    const { user, project, session } = await sessaoEncerrada('active');
    await append.execute(project.id, session.id, {
      type: 'execution.activated',
      actor: { kind: 'user', id: user.id },
      payload: { modules: [] },
    });
    await db
      .update(sessions)
      .set({ status: 'closed', closedAt: FECHOU_EM })
      .where(eq(sessions.id, session.id));
    const { reabrir, startSession } = montar();

    const erro = await reabrir
      .execute(project.id, session.id, user.id)
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ConflictException);
    expect((erro as ConflictException).getResponse()).toMatchObject({
      reason: 'sessao_com_execucao',
    });
    expect(startSession).not.toHaveBeenCalled();
    const [linha] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, session.id));
    expect(linha.status).toBe('closed');
    // `findActiveExecutionSession` continua sem enxergá-la.
    expect(await sessionRepo.findActiveExecutionSession(project.id)).toBeNull();
  });

  it('engine fora do ar: a sessão continua encerrada e nenhum evento entra', async () => {
    const { user, project, session } = await sessaoEncerrada('closed');
    const { reabrir } = montar(
      vi.fn().mockRejectedValue(new Error('engine indisponível')),
    );

    await expect(
      reabrir.execute(project.id, session.id, user.id),
    ).rejects.toThrow('engine indisponível');

    const [linha] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, session.id));
    expect(linha.status).toBe('closed');
    expect(linha.closedAt?.toISOString()).toBe(FECHOU_EM.toISOString());
    expect(await eventosDa(session.id)).toHaveLength(2);
  });
});
