import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  projects,
  sessions,
  users,
  workspaces,
  workspaceMembers,
} from '../../../../src/db/schema';
import { DrizzleHandoffRepository } from '../../../../src/infrastructure/persistence/drizzle/handoff.repository';
import { DrizzleProposedActionRepository } from '../../../../src/infrastructure/persistence/drizzle/proposed-action.repository';
import { GetSessionPendingWorkUseCase } from '../../../../src/application/use-cases/sessions/get-session-pending-work.use-case';

/**
 * O heartbeat encerra a sessão por inatividade da ABA. Esta consulta é o que o
 * impede de encerrar quando alguém ainda está esperando algo — RN-064.
 *
 * A versão anterior cobria só handoff, e dizia por escrito que incluir trabalho
 * de agente "sem um teste que prove a interação seria adivinhar". A execução do
 * `hello-limpo` produziu a prova: a sessão nasceu 23:34:12, uma ação ficou
 * `pending` às 23:34:13, e o heartbeat a fechou às 23:34:42 — exatamente os 30s
 * do timeout —, enquanto o dev agent seguiu trabalhando por mais de uma hora.
 */
const { db, pool } = createTestDb();
const acoes = new DrizzleProposedActionRepository(db);
const useCase = new GetSessionPendingWorkUseCase(
  new DrizzleHandoffRepository(db),
  acoes,
);

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

async function sessao() {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-pending', email: 'pending@brabo.dev' })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: user.id })
    .returning();
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId: user.id, role: 'owner' });
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
    .values({ projectId: project.id, createdBy: user.id })
    .returning();

  return { user, project, session };
}

const acaoPendente = (projectId: string, sessionId: string) =>
  acoes.create({
    projectId,
    sessionId,
    actionType: 'terminal',
    payload: { command: 'ls -la' },
    status: 'pending',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'agent', id: 'dev-http-api' },
    rejectionReason: null,
  });

describe('GetSessionPendingWorkUseCase', () => {
  it('sessão sem nada pendurado libera o encerramento', async () => {
    const { session } = await sessao();

    const r = await useCase.execute(session.id);

    expect(r.pending).toBe(false);
    expect(r.motivo).toBeNull();
  });

  it('ação aguardando decisão SEGURA a sessão (achado V)', async () => {
    const { project, session } = await sessao();
    await acaoPendente(project.id, session.id);

    const r = await useCase.execute(session.id);

    expect(r.pending).toBe(true);
  });

  it('o motivo diz O QUE ficou pendurado, não só que há algo', async () => {
    // O engine escreve esta frase no log. "há trabalho pendente" não ajuda
    // ninguém a diagnosticar por que a sessão não fechou.
    const { project, session } = await sessao();
    await acaoPendente(project.id, session.id);

    const r = await useCase.execute(session.id);

    expect(r.motivo).toContain('terminal');
    expect(r.motivo).toContain('dev-http-api');
  });

  it('ação já DECIDIDA não segura a sessão', async () => {
    // O defeito espelhado: segurar para sempre é tão ruim quanto fechar cedo.
    const { user, project, session } = await sessao();
    const acao = await acaoPendente(project.id, session.id);
    await acoes.updateDecision(acao.id, {
      status: 'approved',
      decidedBy: user.id,
      decidedAt: new Date(),
      rejectionReason: null,
    });

    const r = await useCase.execute(session.id);

    expect(r.pending).toBe(false);
  });

  it('ação pendente de OUTRA sessão não segura esta', async () => {
    const { project, session } = await sessao();
    const [outra] = await db
      .insert(sessions)
      .values({ projectId: project.id, createdBy: session.createdBy })
      .returning();
    await acaoPendente(project.id, outra.id);

    const r = await useCase.execute(session.id);

    expect(r.pending).toBe(false);
  });

  it('a ação MAIS ANTIGA é a que aparece no motivo', async () => {
    const { project, session } = await sessao();
    const primeira = await acaoPendente(project.id, session.id);
    await acoes.create({
      projectId: project.id,
      sessionId: session.id,
      actionType: 'git_push',
      payload: {},
      status: 'pending',
      resolvedPolicy: 'require_approval',
      actor: { kind: 'agent', id: 'dev-outro' },
      rejectionReason: null,
    });

    const r = await useCase.execute(session.id);

    expect(primeira.actionType).toBe('terminal');
    expect(r.motivo).toContain('terminal');
    expect(r.motivo).not.toContain('dev-outro');
  });
});
