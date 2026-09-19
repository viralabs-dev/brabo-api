import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  handoffs,
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
import { DrizzleHandoffRepository } from '../../../../src/infrastructure/persistence/drizzle/handoff.repository';
import { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import { CreateHandoffUseCase } from '../../../../src/application/use-cases/agents/create-handoff.use-case';
import { AcceptHandoffUseCase } from '../../../../src/application/use-cases/agents/accept-handoff.use-case';
import { ActivateAgentUseCase } from '../../../../src/application/use-cases/agents/activate-agent.use-case';
import { SendAgentMessageUseCase } from '../../../../src/application/use-cases/agents/send-agent-message.use-case';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import type { SessionStatus } from '../../../../src/domain/sessions/session-state-machine';
import {
  ehEventoDeConversa,
  TIPOS_DA_CONVERSA,
} from '../../../../src/domain/sessions/conversa-em-sessao-encerrada';

/**
 * RN-581 (AT-072). No `exp001` o heartbeat fechou a sessão com o Criativo
 * esperando resposta, e o log continuou recebendo eventos por quatro minutos
 * depois do `closed_at`: nem o funil nem os casos de uso da conversa olhavam
 * o estado da sessão.
 */
const { db, pool } = createTestDb();
const sessionRepo = new DrizzleSessionRepository(db);
const handoffRepo = new DrizzleHandoffRepository(db);
const append = new AppendSessionEventUseCase(
  new DrizzleUnitOfWork(db),
  sessionRepo,
  new DrizzleSessionEventRepository(db),
  new DrizzleOutboxRepository(db),
);

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

async function sessao(status: SessionStatus) {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-fechada', email: 'fechada@brabo.dev' })
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
      createdBy: user.id,
    })
    .returning();
  const [session] = await db
    .insert(sessions)
    .values({ projectId: project.id, createdBy: user.id, status })
    .returning();
  return { user, project, session };
}

async function eventosGravados(sessionId: string) {
  return db
    .select()
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, sessionId));
}

async function nextSeq(sessionId: string) {
  const [row] = await db
    .select({ nextSeq: sessions.nextSeq })
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  return row.nextSeq;
}

function engineFalso() {
  return {
    sendAgentMessage: vi.fn().mockResolvedValue(undefined),
    startAgent: vi.fn().mockResolvedValue(undefined),
  };
}

describe('a régua (domínio)', () => {
  it('tipo exclusivo da conversa é conversa, qualquer que seja o ator', () => {
    for (const tipo of TIPOS_DA_CONVERSA) {
      expect(ehEventoDeConversa(tipo, { kind: 'user', id: 'u' })).toBe(true);
      expect(ehEventoDeConversa(tipo, { kind: 'system', id: 's' })).toBe(true);
    }
  });

  it('o vocabulário genérico do laço é conversa SÓ quando o ator é conversacional', () => {
    for (const tipo of ['tool.call', 'agent.response', 'agent.error']) {
      expect(ehEventoDeConversa(tipo, { kind: 'agent', id: 'criativo' })).toBe(
        true,
      );
      expect(ehEventoDeConversa(tipo, { kind: 'agent', id: 'dev-lead' })).toBe(
        true,
      );
      expect(ehEventoDeConversa(tipo, { kind: 'agent', id: 'infra' })).toBe(
        true,
      );
      // O Psicólogo roda o MESMO laço contra a sessão já fechada.
      expect(ehEventoDeConversa(tipo, { kind: 'agent', id: 'psicologo' })).toBe(
        false,
      );
      expect(
        ehEventoDeConversa(tipo, { kind: 'agent', id: 'psicologo-leve' }),
      ).toBe(false);
    }
  });

  it('os consumidores do fechamento e as decisões humanas não são conversa', () => {
    const humano = { kind: 'user' as const, id: 'u' };
    expect(ehEventoDeConversa('psychologist.analysis_failed', humano)).toBe(
      false,
    );
    expect(ehEventoDeConversa('anamnese.run_failed', humano)).toBe(false);
    expect(ehEventoDeConversa('hypothesis.accepted', humano)).toBe(false);
    expect(ehEventoDeConversa('action.approved', humano)).toBe(false);
    expect(ehEventoDeConversa('action.denied', humano)).toBe(false);
  });
});

describe('AppendSessionEventUseCase — o funil (RN-581)', () => {
  for (const status of ['closed', 'closed_abnormally'] as const) {
    it(`sessão ${status} recusa chat.message com 409 NOMEADO`, async () => {
      const { user, project, session } = await sessao(status);

      const erro = await append
        .execute(project.id, session.id, {
          type: 'chat.message',
          actor: { kind: 'user', id: user.id },
          payload: { text: 'ainda aí?' },
        })
        .catch((e: unknown) => e);

      expect(erro).toBeInstanceOf(ConflictException);
      const corpo = (erro as ConflictException).getResponse() as Record<
        string,
        unknown
      >;
      expect(corpo.reason).toBe('sessao_encerrada');
      expect(corpo.status).toBe(status);
      expect(corpo.type).toBe('chat.message');
      expect(String(corpo.message)).toContain('encerrada');
    });
  }

  it('a recusa não deixa rastro: nem evento, nem seq consumido', async () => {
    const { project, session } = await sessao('closed');
    const antes = await nextSeq(session.id);

    await expect(
      append.execute(project.id, session.id, {
        type: 'agent.response',
        actor: { kind: 'agent', id: 'criativo' },
        payload: { content: 'tardio' },
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(await eventosGravados(session.id)).toHaveLength(0);
    expect(await nextSeq(session.id)).toBe(antes);
  });

  it('o que o Psicólogo e a Anamnese gravam depois do fechamento continua entrando', async () => {
    const { project, session } = await sessao('closed');
    const psicologo = { kind: 'agent' as const, id: 'psicologo' };

    await append.execute(project.id, session.id, {
      type: 'tool.call',
      actor: psicologo,
      payload: { tool: 'emit_hypotheses' },
    });
    await append.execute(project.id, session.id, {
      type: 'psychologist.analysis_skipped',
      actor: psicologo,
      payload: {},
    });
    await append.execute(project.id, session.id, {
      type: 'anamnese.run_failed',
      actor: { kind: 'agent', id: 'anamnese' },
      payload: {},
    });

    const tipos = (await eventosGravados(session.id)).map((e) => e.type);
    expect(tipos).toEqual([
      'tool.call',
      'psychologist.analysis_skipped',
      'anamnese.run_failed',
    ]);
  });

  it('decisão humana sobre ação continua entrando em sessão fechada (decisão escrita na RN)', async () => {
    const { user, project, session } = await sessao('closed');

    await append.execute(project.id, session.id, {
      type: 'action.approved',
      actor: { kind: 'user', id: user.id },
      payload: {},
    });

    expect(await eventosGravados(session.id)).toHaveLength(1);
  });

  it('sessão ativa aceita conversa normalmente', async () => {
    const { user, project, session } = await sessao('active');

    const evento = await append.execute(project.id, session.id, {
      type: 'chat.message',
      actor: { kind: 'user', id: user.id },
      payload: { text: 'oi' },
    });

    expect(evento.seq).toBe(1);
  });

  it('sessão em closing ainda aceita (a trava é de estado TERMINAL)', async () => {
    const { project, session } = await sessao('closing');

    await append.execute(project.id, session.id, {
      type: 'agent.response',
      actor: { kind: 'agent', id: 'criativo' },
      payload: { content: 'última palavra' },
    });

    expect(await eventosGravados(session.id)).toHaveLength(1);
  });
});

describe('casos de uso da conversa em sessão encerrada (RN-581)', () => {
  it('SendAgentMessage: 409 e o engine NÃO é chamado', async () => {
    const { user, project, session } = await sessao('closed');
    const engine = engineFalso();
    const uc = new SendAgentMessageUseCase(
      engine as unknown as ApiToEngineClient,
      append,
    );

    await expect(
      uc.execute(project.id, session.id, 'criativo', 'oi?', user.id),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(engine.sendAgentMessage).not.toHaveBeenCalled();
  });

  it('CreateHandoff: 409 ANTES de criar a linha — nenhum handoff órfão', async () => {
    const { project, session } = await sessao('closed');
    const uc = new CreateHandoffUseCase(handoffRepo, append);

    await expect(
      uc.execute(project.id, session.id, {
        fromAgent: 'criativo',
        toAgent: 'po',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(
      await db
        .select()
        .from(handoffs)
        .where(eq(handoffs.sessionId, session.id)),
    ).toHaveLength(0);
  });

  it('AcceptHandoff: 409, o handoff segue offered e nenhum agente é ativado', async () => {
    const { user, project, session } = await sessao('active');
    const handoff = await handoffRepo.create({
      sessionId: session.id,
      projectId: project.id,
      fromAgent: 'criativo',
      toAgent: 'po',
      artifactId: null,
      status: 'offered',
    });
    await db
      .update(sessions)
      .set({ status: 'closed' })
      .where(eq(sessions.id, session.id));
    const ativar = { execute: vi.fn() };
    const uc = new AcceptHandoffUseCase(
      handoffRepo,
      {} as never,
      append,
      ativar as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      uc.execute(project.id, session.id, handoff.id, user.id),
    ).rejects.toBeInstanceOf(ConflictException);

    expect((await handoffRepo.findById(handoff.id))?.status).toBe('offered');
    expect(ativar.execute).not.toHaveBeenCalled();
  });

  it('ActivateAgent: 409 e o engine NÃO sobe o agente', async () => {
    const { user, project, session } = await sessao('closed');
    const engine = engineFalso();
    const uc = new ActivateAgentUseCase(
      sessionRepo,
      handoffRepo,
      engine as unknown as ApiToEngineClient,
      append,
    );

    await expect(
      uc.execute(project.id, session.id, 'criativo', user.id),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(engine.startAgent).not.toHaveBeenCalled();
  });

  it('ActivateAgent em sessão ativa segue subindo o agente', async () => {
    const { user, project, session } = await sessao('active');
    const engine = engineFalso();
    const uc = new ActivateAgentUseCase(
      sessionRepo,
      handoffRepo,
      engine as unknown as ApiToEngineClient,
      append,
    );

    await uc.execute(project.id, session.id, 'criativo', user.id);

    expect(engine.startAgent).toHaveBeenCalledOnce();
  });
});
