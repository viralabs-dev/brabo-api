import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { ulid } from 'ulid';
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
import { DrizzleSessionEventRepository } from '../../../../src/infrastructure/persistence/drizzle/session-event.repository';
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
 *
 * O TERCEIRO sinal (esta rodada): `AcceptHandoffUseCase` ativa o próximo
 * agente por `GenServer.cast` fire-and-forget — entre a ativação e o agente
 * oferecer o handoff seguinte (ou terminar), nem handoff `offered` nem
 * `proposed_action` pendente existem, só o ping do canal Phoenix segurava a
 * sessão. `agent.status` (working/idle) é o que os agentes conversacionais
 * (Criativo/PO/Arquiteto/Dev Lead/Infra) narram nos limites de turno, e é
 * PERSISTIDO no event log (ADR 0021) — o mesmo sinal que o painel do time já
 * lê para o roster.
 */
const { db, pool } = createTestDb();
const acoes = new DrizzleProposedActionRepository(db);
const eventos = new DrizzleSessionEventRepository(db);
const useCase = new GetSessionPendingWorkUseCase(
  new DrizzleHandoffRepository(db),
  acoes,
  eventos,
);

beforeEach(async () => {
  await truncateAll(db);
  seqCounter = 0;
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

let seqCounter = 0;

const agentStatus = (
  sessionId: string,
  agentId: string,
  status: 'working' | 'idle',
) =>
  eventos.append({
    id: ulid(),
    sessionId,
    seq: ++seqCounter,
    type: 'agent.status',
    actor: { kind: 'agent', id: agentId },
    payload: { status },
  });

const devEvent = (sessionId: string, agentId: string, type: string) =>
  eventos.append({
    id: ulid(),
    sessionId,
    seq: ++seqCounter,
    type,
    actor: { kind: 'agent', id: agentId },
    payload: { agentId },
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

  it('agente ATIVADO ainda em turno SEGURA a sessão (o defeito relatado)', async () => {
    // O cenário real: o PO foi ativado pelo handoff aceito e está no meio do
    // kickoff (até 12 iterações de LLM) — `agent.status: working` gravado,
    // sem `idle` posterior nenhum ainda.
    const { session } = await sessao();
    await agentStatus(session.id, 'po', 'working');

    const r = await useCase.execute(session.id);

    expect(r.pending).toBe(true);
    expect(r.motivo).toContain('po');
  });

  it('agente que já TERMINOU o turno (idle) não segura a sessão', async () => {
    const { session } = await sessao();
    await agentStatus(session.id, 'po', 'working');
    await agentStatus(session.id, 'po', 'idle');

    const r = await useCase.execute(session.id);

    expect(r.pending).toBe(false);
    expect(r.motivo).toBeNull();
  });

  it('é genérico por tipo de agente — não hardcoded pro "po"', async () => {
    // Mesma mecânica pro Arquiteto ativando o Infra/Dev Lead via handoff.
    const { session } = await sessao();
    await agentStatus(session.id, 'infra', 'working');

    const r = await useCase.execute(session.id);

    expect(r.pending).toBe(true);
    expect(r.motivo).toContain('infra');
  });

  it('só o ÚLTIMO status de cada ator importa, não a história inteira', async () => {
    // Criativo terminou (idle); PO foi ativado depois e está em turno agora.
    // Sem isolar por ator, o idle mais antigo do Criativo não pode mascarar
    // o working mais recente do PO, nem o contrário.
    const { session } = await sessao();
    await agentStatus(session.id, 'criativo', 'working');
    await agentStatus(session.id, 'criativo', 'idle');
    await agentStatus(session.id, 'po', 'working');

    const r = await useCase.execute(session.id);

    expect(r.pending).toBe(true);
    expect(r.motivo).toContain('po');
  });

  it('agent.status de OUTRA sessão não segura esta', async () => {
    const { session } = await sessao();
    const [outra] = await db
      .insert(sessions)
      .values({ projectId: session.projectId, createdBy: session.createdBy })
      .returning();
    await agentStatus(outra.id, 'po', 'working');

    const r = await useCase.execute(session.id);

    expect(r.pending).toBe(false);
  });

  // Quarto sinal (RN-410): dev agents não emitem `agent.status` — usam
  // vocabulário próprio (`dev.*`). O achado real: cinco dev agents subiram,
  // ficaram `idle_tripped` (RN-047, o circuit breaker), e o heartbeat
  // fechou a sessão por baixo enquanto o usuário ainda desbloqueava tarefas
  // manualmente — o terceiro sinal (agent.status) nunca via nada.
  it('dev agent TRABALHANDO segura a sessão (dev.working)', async () => {
    const { session } = await sessao();
    await devEvent(session.id, 'dev-api', 'dev.started');
    await devEvent(session.id, 'dev-api', 'dev.working');

    const r = await useCase.execute(session.id);

    expect(r.pending).toBe(true);
    expect(r.motivo).toContain('dev-api');
    expect(r.motivo).toContain('working');
  });

  it('dev agent TRAVADO esperando desbloqueio segura a sessão (dev.idle_tripped, o defeito relatado)', async () => {
    const { session } = await sessao();
    await devEvent(session.id, 'dev-api', 'dev.started');
    await devEvent(session.id, 'dev-api', 'dev.working');
    await devEvent(session.id, 'dev-api', 'dev.blocked');
    await devEvent(session.id, 'dev-api', 'dev.idle_tripped');

    const r = await useCase.execute(session.id);

    expect(r.pending).toBe(true);
    expect(r.motivo).toContain('dev-api');
    expect(r.motivo).toContain('idle_tripped');
  });

  it('dev.blocked, sozinho como último evento, também segura a sessão', async () => {
    const { session } = await sessao();
    await devEvent(session.id, 'dev-api', 'dev.working');
    await devEvent(session.id, 'dev-api', 'dev.blocked');

    const r = await useCase.execute(session.id);

    expect(r.pending).toBe(true);
    expect(r.motivo).toContain('blocked');
  });

  it('dev agent OCIOSO (dev.idle, drenado de verdade) NÃO segura a sessão', async () => {
    const { session } = await sessao();
    await devEvent(session.id, 'dev-api', 'dev.started');
    await devEvent(session.id, 'dev-api', 'dev.idle');

    const r = await useCase.execute(session.id);

    expect(r.pending).toBe(false);
    expect(r.motivo).toBeNull();
  });

  it('sessão sem NENHUM evento dev.* preserva o comportamento atual', async () => {
    const { session } = await sessao();

    const r = await useCase.execute(session.id);

    expect(r.pending).toBe(false);
    expect(r.motivo).toBeNull();
  });

  it('só o ÚLTIMO evento dev.* de cada agente importa, não a história inteira', async () => {
    // dev-web terminou de verdade (idle); dev-api ficou travado depois.
    const { session } = await sessao();
    await devEvent(session.id, 'dev-web', 'dev.working');
    await devEvent(session.id, 'dev-web', 'dev.idle');
    await devEvent(session.id, 'dev-api', 'dev.working');
    await devEvent(session.id, 'dev-api', 'dev.blocked');
    await devEvent(session.id, 'dev-api', 'dev.idle_tripped');

    const r = await useCase.execute(session.id);

    expect(r.pending).toBe(true);
    expect(r.motivo).toContain('dev-api');
    expect(r.motivo).not.toContain('dev-web');
  });

  it('é genérico por módulo — dev-<modulo>-2 (extra) também segura', async () => {
    const { session } = await sessao();
    await devEvent(session.id, 'dev-web-2', 'dev.working');

    const r = await useCase.execute(session.id);

    expect(r.pending).toBe(true);
    expect(r.motivo).toContain('dev-web-2');
  });

  it('evento dev.* de OUTRA sessão não segura esta', async () => {
    const { session } = await sessao();
    const [outra] = await db
      .insert(sessions)
      .values({ projectId: session.projectId, createdBy: session.createdBy })
      .returning();
    await devEvent(outra.id, 'dev-api', 'dev.working');

    const r = await useCase.execute(session.id);

    expect(r.pending).toBe(false);
  });
});
