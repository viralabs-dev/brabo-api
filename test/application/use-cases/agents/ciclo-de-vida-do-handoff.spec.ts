import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
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
import { ActivateAgentUseCase } from '../../../../src/application/use-cases/agents/activate-agent.use-case';
import { CicloDeVidaDoHandoff } from '../../../../src/application/use-cases/agents/ciclo-de-vida-do-handoff.service';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import type { SessionStatus } from '../../../../src/domain/sessions/session-state-machine';
import { RECUSA_AGENTE_JA_ATIVO } from '../../../../src/domain/sessions/ciclo-de-vida-do-handoff';

/**
 * ADR 0182 (RN-635), contra Postgres de verdade — o lock consultivo e a
 * transação só se provam com banco. No uso real, o duplo clique em
 * "arquitetura pronta" dava duas ofertas ao Infra e duas ao Dev Lead, e uma
 * oferta a agente já ativo ficava `offered` para sempre.
 */
const { db, pool } = createTestDb();
const sessionRepo = new DrizzleSessionRepository(db);
const handoffRepo = new DrizzleHandoffRepository(db);
const eventRepo = new DrizzleSessionEventRepository(db);
const unitOfWork = new DrizzleUnitOfWork(db);
const append = new AppendSessionEventUseCase(
  unitOfWork,
  sessionRepo,
  eventRepo,
  new DrizzleOutboxRepository(db),
);
const ciclo = new CicloDeVidaDoHandoff(
  handoffRepo,
  eventRepo,
  sessionRepo,
  append,
  unitOfWork,
);
const criar = new CreateHandoffUseCase(handoffRepo, append, unitOfWork, ciclo);

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

async function projetoComSessoes(...status: SessionStatus[]) {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-ciclo', email: 'ciclo@brabo.dev' })
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
  const criadas: (typeof sessions.$inferSelect)[] = [];
  for (const s of status) {
    const [session] = await db
      .insert(sessions)
      .values({ projectId: project.id, createdBy: user.id, status: s })
      .returning();
    criadas.push(session);
  }
  return { user, project, sessoes: criadas };
}

async function linhas(projectId: string, toAgent: string) {
  return db
    .select()
    .from(handoffs)
    .where(
      and(eq(handoffs.projectId, projectId), eq(handoffs.toAgent, toAgent)),
    );
}

async function eventos(sessionId: string, type: string) {
  return db
    .select()
    .from(sessionEvents)
    .where(
      and(eq(sessionEvents.sessionId, sessionId), eq(sessionEvents.type, type)),
    );
}

async function ativar(projectId: string, sessionId: string, agent: string) {
  await append.execute(projectId, sessionId, {
    type: 'agent.activated',
    actor: { kind: 'user', id: 'u' },
    payload: { agent },
  });
}

describe('CreateHandoffUseCase — uma oferta pendente por (projeto, destino)', () => {
  it('a mesma oferta repetida na mesma sessão devolve a existente: uma linha, um evento', async () => {
    const { project, sessoes } = await projetoComSessoes('active');
    const [s] = sessoes;

    const primeira = await criar.execute(project.id, s.id, {
      fromAgent: 'arquiteto',
      toAgent: 'infra',
    });
    const segunda = await criar.execute(project.id, s.id, {
      fromAgent: 'arquiteto',
      toAgent: 'infra',
    });

    expect(primeira.desfecho).toBe('criado');
    expect(segunda.desfecho).toBe('ja_oferecido');
    expect(segunda.id).toBe(primeira.id);
    expect(await linhas(project.id, 'infra')).toHaveLength(1);
    expect(await eventos(s.id, 'handoff.offered')).toHaveLength(1);
  });

  it('duplo clique CONCORRENTE não cria duas: o lock por destino serializa', async () => {
    const { project, sessoes } = await projetoComSessoes('active');
    const [s] = sessoes;

    const resultados = await Promise.all(
      [1, 2, 3].map(() =>
        criar.execute(project.id, s.id, {
          fromAgent: 'arquiteto',
          toAgent: 'dev-lead',
        }),
      ),
    );

    expect(await linhas(project.id, 'dev-lead')).toHaveLength(1);
    expect(new Set(resultados.map((r) => r.id)).size).toBe(1);
    expect(resultados.filter((r) => r.desfecho === 'criado')).toHaveLength(1);
  });

  it('artefato NOVO substitui a oferta anterior, com handoff.superseded apontando a substituta', async () => {
    const { project, sessoes } = await projetoComSessoes('active');
    const [s] = sessoes;

    const velha = await criar.execute(project.id, s.id, {
      fromAgent: 'criativo',
      toAgent: 'po',
      artifactId: 'brief-1',
    });
    const nova = await criar.execute(project.id, s.id, {
      fromAgent: 'criativo',
      toAgent: 'po',
      artifactId: 'brief-2',
    });

    expect(nova.desfecho).toBe('substituiu_oferta');
    expect(nova.artifactId).toBe('brief-2');
    const estado = Object.fromEntries(
      (await linhas(project.id, 'po')).map((h) => [h.id, h.status]),
    );
    expect(estado).toEqual({ [velha.id]: 'superseded', [nova.id]: 'offered' });
    const [substituicao] = await eventos(s.id, 'handoff.superseded');
    expect(substituicao.payload).toEqual({
      handoffId: velha.id,
      toAgent: 'po',
      motivo: 'nova_oferta',
      substitutaId: nova.id,
    });
    expect(substituicao.actorKind).toBe('system');
  });

  it('oferta vinda de OUTRA sessão substitui a pendente — o evento cai na sessão da velha, mesmo encerrada', async () => {
    const { project, sessoes } = await projetoComSessoes('active', 'active');
    const [s1, s2] = sessoes;
    const velha = await criar.execute(project.id, s1.id, {
      fromAgent: 'arquiteto',
      toAgent: 'infra',
    });
    // A sessão da oferta velha fecha: ninguém mais a aceitaria (RN-581).
    await db
      .update(sessions)
      .set({ status: 'closed' })
      .where(eq(sessions.id, s1.id));

    const nova = await criar.execute(project.id, s2.id, {
      fromAgent: 'arquiteto',
      toAgent: 'infra',
    });

    expect(nova.sessionId).toBe(s2.id);
    expect((await handoffRepo.findById(velha.id))?.status).toBe('superseded');
    expect(await eventos(s1.id, 'handoff.superseded')).toHaveLength(1);
  });

  it('`seAusente` (AppSec, RN-636) devolve a pendente de qualquer sessão, sem substituir', async () => {
    const { project, sessoes } = await projetoComSessoes('active', 'active');
    const [s1, s2] = sessoes;
    const existente = await criar.execute(project.id, s1.id, {
      fromAgent: 'appsec',
      toAgent: 'arquiteto',
      artifactId: 'threat-1',
    });

    const r = await criar.execute(project.id, s2.id, {
      fromAgent: 'appsec',
      toAgent: 'arquiteto',
      artifactId: 'threat-2',
      seAusente: true,
    });

    expect(r.desfecho).toBe('ja_oferecido');
    expect(r.id).toBe(existente.id);
    expect(await linhas(project.id, 'arquiteto')).toHaveLength(1);
    expect(await eventos(s2.id, 'handoff.offered')).toHaveLength(0);
  });

  it('dado de antes do ADR (duas pendentes) converge na próxima oferta', async () => {
    const { project, sessoes } = await projetoComSessoes('active');
    const [s] = sessoes;
    const base = {
      sessionId: s.id,
      projectId: project.id,
      fromAgent: 'arquiteto',
      toAgent: 'infra',
      artifactId: null,
      status: 'offered' as const,
    };
    const antiga = await handoffRepo.create(base);
    const recente = await handoffRepo.create(base);

    const r = await criar.execute(project.id, s.id, {
      fromAgent: 'arquiteto',
      toAgent: 'infra',
    });

    expect(r.id).toBe(recente.id);
    expect((await handoffRepo.findById(antiga.id))?.status).toBe('superseded');
  });

  it('agente já ATIVO no projeto: 409 `agente_ja_ativo`, sem linha e sem evento', async () => {
    const { project, sessoes } = await projetoComSessoes('active', 'active');
    const [s1, s2] = sessoes;
    await ativar(project.id, s1.id, 'po');

    const erro = await criar
      .execute(project.id, s2.id, { fromAgent: 'criativo', toAgent: 'po' })
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ConflictException);
    const corpo = (erro as ConflictException).getResponse() as {
      reason: string;
      message: string;
    };
    expect(corpo.reason).toBe(RECUSA_AGENTE_JA_ATIVO);
    // É o texto que o modelo lê como resultado da ferramenta (RN-163).
    expect(corpo.message).toMatch(/"po" já está ativo neste projeto/);
    expect(await linhas(project.id, 'po')).toHaveLength(0);
    expect(await eventos(s2.id, 'handoff.offered')).toHaveLength(0);
  });

  it('ativo numa sessão ENCERRADA não conta: a oferta nasce', async () => {
    const { project, sessoes } = await projetoComSessoes('active', 'active');
    const [s1, s2] = sessoes;
    await ativar(project.id, s1.id, 'po');
    await db
      .update(sessions)
      .set({ status: 'closed' })
      .where(eq(sessions.id, s1.id));

    const r = await criar.execute(project.id, s2.id, {
      fromAgent: 'criativo',
      toAgent: 'po',
    });

    expect(r.desfecho).toBe('criado');
  });
});

describe('ActivateAgentUseCase — ativar substitui as ofertas ao mesmo destino', () => {
  it('oferta pendente em OUTRA sessão vira superseded quando o agente é ativado', async () => {
    const { user, project, sessoes } = await projetoComSessoes(
      'active',
      'active',
    );
    const [s1, s2] = sessoes;
    const pendente = await criar.execute(project.id, s2.id, {
      fromAgent: 'staff',
      toAgent: 'arquiteto',
    });
    // Em s1 o Arquiteto tem handoff aceito (é o que deixa ativá-lo ali).
    await handoffRepo.create({
      sessionId: s1.id,
      projectId: project.id,
      fromAgent: 'po',
      toAgent: 'arquiteto',
      status: 'accepted',
    });
    const engine = { startAgent: vi.fn().mockResolvedValue(undefined) };
    const uc = new ActivateAgentUseCase(
      sessionRepo,
      handoffRepo,
      engine as unknown as ApiToEngineClient,
      append,
      ciclo,
    );

    await uc.execute(project.id, s1.id, 'arquiteto', user.id);

    expect((await handoffRepo.findById(pendente.id))?.status).toBe(
      'superseded',
    );
    const [ev] = await eventos(s2.id, 'handoff.superseded');
    expect(ev.payload).toMatchObject({
      handoffId: pendente.id,
      motivo: 'agente_ativado',
      substitutaId: null,
    });
    // A aceita não é tocada.
    const aceitas = (await linhas(project.id, 'arquiteto')).filter(
      (h) => h.status === 'accepted',
    );
    expect(aceitas).toHaveLength(1);
  });

  it('ativação recusada não substitui nada', async () => {
    const { user, project, sessoes } = await projetoComSessoes(
      'active',
      'active',
    );
    const [s1, s2] = sessoes;
    const pendente = await criar.execute(project.id, s2.id, {
      fromAgent: 'staff',
      toAgent: 'arquiteto',
    });
    const uc = new ActivateAgentUseCase(
      sessionRepo,
      handoffRepo,
      { startAgent: vi.fn() } as unknown as ApiToEngineClient,
      append,
      ciclo,
    );

    // Sem handoff aceito em s1: 403, nada muda.
    await expect(
      uc.execute(project.id, s1.id, 'arquiteto', user.id),
    ).rejects.toThrow();
    expect((await handoffRepo.findById(pendente.id))?.status).toBe('offered');
  });
});
