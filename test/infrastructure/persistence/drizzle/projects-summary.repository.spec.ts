import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  budgets,
  delegations,
  handoffs,
  moduleMaps,
  projectRepositories,
  projects,
  proposedActions,
  repoBootstraps,
  sessionEvents,
  sessions,
  epics,
  stories,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleProjectsSummaryRepository } from '../../../../src/infrastructure/persistence/drizzle/projects-summary.repository';

const { db, pool } = createTestDb();
const repo = new DrizzleProjectsSummaryRepository(db);

let seq = 0;

async function criarUsuario(email: string) {
  const [row] = await db
    .insert(users)
    .values({ keycloakSub: `sub-${email}`, email, name: email })
    .returning();
  return row;
}

async function criarWorkspace(ownerId: string, slug: string) {
  const [row] = await db
    .insert(workspaces)
    .values({ name: slug, slug, createdBy: ownerId })
    .returning();
  return row;
}

async function criarProjeto(
  workspaceId: string,
  ownerId: string,
  slug: string,
) {
  const [row] = await db
    .insert(projects)
    .values({ workspaceId, name: slug, slug, createdBy: ownerId })
    .returning();
  return row;
}

async function criarSessao(projectId: string, ownerId: string) {
  const [row] = await db
    .insert(sessions)
    .values({ projectId, createdBy: ownerId })
    .returning();
  return row;
}

async function criarAcaoProposta(
  projectId: string,
  sessionId: string,
  status:
    | 'pending'
    | 'approved'
    | 'denied'
    | 'auto_approved'
    | 'executed'
    | 'failed' = 'pending',
) {
  const [row] = await db
    .insert(proposedActions)
    .values({
      projectId,
      sessionId,
      actionType: 'terminal',
      resolvedPolicy: 'require_approval',
      actorKind: 'agent',
      actorId: 'dev',
      status,
    })
    .returning();
  return row;
}

async function gravarEvento(sessionId: string, type: string, actorId = 'po') {
  seq += 1;
  const [row] = await db
    .insert(sessionEvents)
    .values({
      id: `evt-${seq}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      seq,
      type,
      actorKind: 'agent',
      actorId,
      payload: {},
    })
    .returning();
  // `nextSeq` da sessão é o que vira `latestSeq` no resumo.
  await db
    .update(sessions)
    .set({ nextSeq: seq + 1 })
    .where(sql`${sessions.id} = ${sessionId}`);
  return row;
}

beforeEach(async () => {
  await truncateAll(db);
  seq = 0;
});

afterAll(async () => {
  await pool.end();
});

describe('DrizzleProjectsSummaryRepository', () => {
  it('workspace sem projeto: lista vazia', async () => {
    const owner = await criarUsuario('vazio@brabo.dev');
    const ws = await criarWorkspace(owner.id, 'sem-projeto');

    expect(await repo.summarizeForWorkspace(ws.id)).toEqual([]);
  });

  it('projeto recém-criado: tudo nulo, e nada explode', async () => {
    const owner = await criarUsuario('novo@brabo.dev');
    const ws = await criarWorkspace(owner.id, 'novo');
    const projeto = await criarProjeto(ws.id, owner.id, 'core');

    const [resumo] = await repo.summarizeForWorkspace(ws.id);

    expect(resumo).toEqual({
      projectId: projeto.id,
      // Sem linha em project_repositories, o projeto é local.
      provider: 'local',
      provisioningStatus: null,
      budget: null,
      latestSessionId: null,
      latestSeq: 0,
      lastEvent: null,
      storiesAwaitingPromotion: 0,
      pendingApprovalsCount: 0,
      roster: {
        executionActivated: false,
        moduleNames: [],
        gatesEverOpened: false,
        delegatedSubagents: [],
        infraActive: false,
        staffActive: false,
      },
    });
  });

  it('reúne git, orçamento, atividade, promoções e os fatos da roster', async () => {
    const owner = await criarUsuario('cheio@brabo.dev');
    const ws = await criarWorkspace(owner.id, 'cheio');
    const projeto = await criarProjeto(ws.id, owner.id, 'core');
    const sessao = await criarSessao(projeto.id, owner.id);

    await db.insert(projectRepositories).values({
      projectId: projeto.id,
      provider: 'github',
      externalId: 'daneiel/core',
      url: 'https://github.com/daneiel/core',
      visibility: 'private',
      provisionedBy: owner.id,
    });
    await db.insert(repoBootstraps).values({
      projectId: projeto.id,
      sessionId: sessao.id,
      step: 'protect_branches',
      status: 'done',
    });
    await db.insert(budgets).values({
      projectId: projeto.id,
      limitMicros: 50_000_000,
      spentMicros: 7_500_000,
    });
    await db.insert(moduleMaps).values({
      projectId: projeto.id,
      sessionId: sessao.id,
      modules: [
        { name: 'api', stack: 'Nest', responsibility: 'http', dependsOn: [] },
      ],
      version: 1,
    });
    await db.insert(handoffs).values({
      sessionId: sessao.id,
      projectId: projeto.id,
      fromAgent: 'arquiteto',
      toAgent: 'infra',
      status: 'accepted',
    });
    // Staff (docs/fluxo.yml, ADR 0088) — ativação MANUAL já aceita.
    await db.insert(handoffs).values({
      sessionId: sessao.id,
      projectId: projeto.id,
      fromAgent: 'arquiteto',
      toAgent: 'staff',
      status: 'accepted',
    });
    await db.insert(delegations).values({
      projectId: projeto.id,
      sessionId: sessao.id,
      area: 'qa',
      leadAgent: 'qa',
      subagent: 'qa-automacao',
      status: 'completed',
      // `delegations_completed_tem_parecer`: delegação concluída sem parecer é
      // recusada pelo banco.
      parecerArtifactId: 'evt-parecer-1',
    });

    await gravarEvento(sessao.id, 'execution.activated', 'sistema');
    await gravarEvento(sessao.id, 'pr.gate_changed', 'qa');
    const ultimo = await gravarEvento(sessao.id, 'chat.message', 'po');

    const [epico] = await db
      .insert(epics)
      .values({ projectId: projeto.id, sessionId: sessao.id, title: 'Épico' })
      .returning();
    await db.insert(stories).values([
      {
        epicId: epico.id,
        projectId: projeto.id,
        sessionId: sessao.id,
        title: 'Aguardando',
        proposedReady: true,
      },
      {
        epicId: epico.id,
        projectId: projeto.id,
        sessionId: sessao.id,
        title: 'Comum',
        proposedReady: false,
      },
    ]);

    // Duas pendentes e uma já decidida — só as `pending` contam (RN-151).
    await criarAcaoProposta(projeto.id, sessao.id, 'pending');
    await criarAcaoProposta(projeto.id, sessao.id, 'pending');
    await criarAcaoProposta(projeto.id, sessao.id, 'approved');

    const [resumo] = await repo.summarizeForWorkspace(ws.id);

    expect(resumo.provider).toBe('github');
    expect(resumo.provisioningStatus).toBe('provisioned');
    expect(resumo.budget).toEqual({
      limitMicros: 50_000_000,
      spentMicros: 7_500_000,
    });
    expect(resumo.latestSessionId).toBe(sessao.id);
    // `nextSeq - 1` — o último seq JÁ gravado.
    expect(resumo.latestSeq).toBe(3);
    expect(resumo.lastEvent?.id).toBe(ultimo.id);
    expect(resumo.lastEvent?.type).toBe('chat.message');
    expect(resumo.storiesAwaitingPromotion).toBe(1);
    expect(resumo.pendingApprovalsCount).toBe(2);
    expect(resumo.roster).toEqual({
      executionActivated: true,
      moduleNames: ['api'],
      gatesEverOpened: true,
      delegatedSubagents: ['qa-automacao'],
      infraActive: true,
      staffActive: true,
    });
  });

  it('cada projeto fica com o SEU resumo, sem vazar do vizinho', async () => {
    const owner = await criarUsuario('doisprojetos@brabo.dev');
    const ws = await criarWorkspace(owner.id, 'dois');
    const comGit = await criarProjeto(ws.id, owner.id, 'com-git');
    const semGit = await criarProjeto(ws.id, owner.id, 'sem-git');

    await db.insert(projectRepositories).values({
      projectId: comGit.id,
      provider: 'gitlab',
      externalId: 'g/com-git',
      url: 'https://gitlab.com/g/com-git',
      visibility: 'private',
      provisionedBy: owner.id,
    });

    const resumos = await repo.summarizeForWorkspace(ws.id);
    const porId = new Map(resumos.map((r) => [r.projectId, r]));

    expect(porId.get(comGit.id)?.provider).toBe('gitlab');
    expect(porId.get(semGit.id)?.provider).toBe('local');
  });

  it('não enxerga projeto de outro workspace', async () => {
    const owner = await criarUsuario('isolado@brabo.dev');
    const a = await criarWorkspace(owner.id, 'ws-a');
    const b = await criarWorkspace(owner.id, 'ws-b');
    const doA = await criarProjeto(a.id, owner.id, 'core');
    await criarProjeto(b.id, owner.id, 'core');

    const resumos = await repo.summarizeForWorkspace(a.id);

    expect(resumos.map((r) => r.projectId)).toEqual([doA.id]);
  });

  /**
   * RN-151: o número que vira badge da sidebar é `proposed_actions` pendentes
   * do projeto INTEIRO — todas as sessões, não só a mais recente — e nunca
   * vaza para o projeto vizinho.
   */
  it('pendingApprovalsCount soma o projeto INTEIRO, não só a sessão mais recente', async () => {
    const owner = await criarUsuario('pendencias@brabo.dev');
    const ws = await criarWorkspace(owner.id, 'pendencias');
    const comPendencia = await criarProjeto(ws.id, owner.id, 'com-pendencia');
    const semPendencia = await criarProjeto(ws.id, owner.id, 'sem-pendencia');

    const antiga = await criarSessao(comPendencia.id, owner.id);
    await db
      .update(sessions)
      .set({ createdAt: new Date(Date.now() - 60_000) })
      .where(sql`${sessions.id} = ${antiga.id}`);
    const recente = await criarSessao(comPendencia.id, owner.id);

    // Uma pendência em cada sessão do projeto — a soma conta as DUAS, mesmo a
    // sessão que não é mais a "mais recente".
    await criarAcaoProposta(comPendencia.id, antiga.id, 'pending');
    await criarAcaoProposta(comPendencia.id, recente.id, 'pending');
    await criarAcaoProposta(comPendencia.id, recente.id, 'denied');

    const sessaoSemPendencia = await criarSessao(semPendencia.id, owner.id);
    await criarAcaoProposta(semPendencia.id, sessaoSemPendencia.id, 'executed');

    const resumos = await repo.summarizeForWorkspace(ws.id);
    const porId = new Map(resumos.map((r) => [r.projectId, r]));

    expect(porId.get(comPendencia.id)?.pendingApprovalsCount).toBe(2);
    expect(porId.get(semPendencia.id)?.pendingApprovalsCount).toBe(0);
  });

  it('usa a sessão MAIS RECENTE quando o projeto tem várias', async () => {
    const owner = await criarUsuario('varias@brabo.dev');
    const ws = await criarWorkspace(owner.id, 'varias');
    const projeto = await criarProjeto(ws.id, owner.id, 'core');

    const antiga = await criarSessao(projeto.id, owner.id);
    await db
      .update(sessions)
      .set({ createdAt: new Date(Date.now() - 60_000) })
      .where(sql`${sessions.id} = ${antiga.id}`);
    const recente = await criarSessao(projeto.id, owner.id);

    await gravarEvento(antiga.id, 'chat.message');
    await gravarEvento(recente.id, 'pr.gate_changed', 'qa');

    const [resumo] = await repo.summarizeForWorkspace(ws.id);

    expect(resumo.latestSessionId).toBe(recente.id);
    expect(resumo.roster.gatesEverOpened).toBe(true);
  });

  /**
   * A propriedade que a correção inteira depende: o custo é CONSTANTE.
   *
   * Um `for (const projeto of projetos)` dentro do repositório passaria em
   * todos os testes acima e devolveria os mesmos dados — só trocaria N+1 de
   * HTTP por N+1 de SQL. Este teste é o que impede isso, e por isso conta
   * idas ao banco em vez de olhar o resultado.
   */
  it('o número de consultas NÃO cresce com a quantidade de projetos', async () => {
    const owner = await criarUsuario('escala@brabo.dev');
    const ws = await criarWorkspace(owner.id, 'escala');

    const contarConsultas = async (n: number): Promise<number> => {
      await truncateAll(db);
      const owner2 = await criarUsuario(`escala-${n}@brabo.dev`);
      const ws2 = await criarWorkspace(owner2.id, `escala-${n}`);
      for (let i = 0; i < n; i++) {
        const p = await criarProjeto(ws2.id, owner2.id, `p-${i}`);
        const s = await criarSessao(p.id, owner2.id);
        await gravarEvento(s.id, 'chat.message');
      }

      const original = pool.query.bind(pool);
      let consultas = 0;
      (pool as { query: unknown }).query = (...args: unknown[]) => {
        consultas += 1;
        return (original as (...a: unknown[]) => unknown)(...args);
      };
      try {
        const resumos = await repo.summarizeForWorkspace(ws2.id);
        expect(resumos).toHaveLength(n);
      } finally {
        (pool as { query: unknown }).query = original;
      }
      return consultas;
    };

    const comDois = await contarConsultas(2);
    const comVinte = await contarConsultas(20);

    expect(comVinte).toBe(comDois);
    // Sanidade: se as duas fossem 0, a igualdade acima não provaria nada.
    expect(comDois).toBeGreaterThan(0);
    expect(ws.id).toBeTruthy();
  });
});

/**
 * A gaveta do sino, em lote (RN-091).
 *
 * O que estes testes protegem não é só o custo: é a SEMÂNTICA do `afterSeq`
 * por projeto. Batelar leituras cujo corte é diferente em cada uma é onde o
 * erro fácil mora — um corte só para todo mundo, ou nenhum, devolve dados
 * plausíveis e ERRADOS.
 */
describe('DrizzleProjectsSummaryRepository — não lidos em lote', () => {
  it('lista de cursores VAZIA devolve vazio, e sem tocar no banco', async () => {
    const owner = await criarUsuario('vazio-sino@brabo.dev');
    const ws = await criarWorkspace(owner.id, 'vazio-sino');
    const projeto = await criarProjeto(ws.id, owner.id, 'core');
    const sessao = await criarSessao(projeto.id, owner.id);
    await gravarEvento(sessao.id, 'chat.message');

    const original = pool.query.bind(pool);
    let consultas = 0;
    (pool as { query: unknown }).query = (...args: unknown[]) => {
      consultas += 1;
      return (original as (...a: unknown[]) => unknown)(...args);
    };
    try {
      // "Não perguntei nada" não é "me dê tudo": o projeto acima TEM evento
      // não lido, e mesmo assim a resposta é vazia.
      await expect(repo.unreadEventsForWorkspace(ws.id, [])).resolves.toEqual(
        [],
      );
    } finally {
      (pool as { query: unknown }).query = original;
    }

    expect(consultas).toBe(0);
  });

  it('cada projeto respeita o SEU corte', async () => {
    const owner = await criarUsuario('cortes@brabo.dev');
    const ws = await criarWorkspace(owner.id, 'cortes');
    const a = await criarProjeto(ws.id, owner.id, 'a');
    const b = await criarProjeto(ws.id, owner.id, 'b');
    const sa = await criarSessao(a.id, owner.id);
    const sb = await criarSessao(b.id, owner.id);

    const a1 = await gravarEvento(sa.id, 'chat.message');
    const a2 = await gravarEvento(sa.id, 'agent.response');
    const b1 = await gravarEvento(sb.id, 'chat.message');
    const b2 = await gravarEvento(sb.id, 'agent.response');

    // `a` foi lido até o primeiro evento; `b` nunca foi lido.
    const grupos = await repo.unreadEventsForWorkspace(ws.id, [
      { projectId: a.id, afterSeq: a1.seq },
      { projectId: b.id, afterSeq: 0 },
    ]);

    const porProjeto = new Map(grupos.map((g) => [g.projectId, g]));
    expect(porProjeto.get(a.id)?.events.map((e) => e.id)).toEqual([a2.id]);
    // Do mais NOVO para o mais antigo (RN-100).
    expect(porProjeto.get(b.id)?.events.map((e) => e.id)).toEqual([
      b2.id,
      b1.id,
    ]);
  });

  it('projeto sem evento novo some da resposta, em vez de vir vazio', async () => {
    const owner = await criarUsuario('emdia@brabo.dev');
    const ws = await criarWorkspace(owner.id, 'emdia');
    const projeto = await criarProjeto(ws.id, owner.id, 'core');
    const sessao = await criarSessao(projeto.id, owner.id);
    const ultimo = await gravarEvento(sessao.id, 'chat.message');

    const grupos = await repo.unreadEventsForWorkspace(ws.id, [
      { projectId: projeto.id, afterSeq: ultimo.seq },
    ]);

    expect(grupos).toEqual([]);
  });

  it('projeto de OUTRO workspace é ignorado, não vaza nem estoura', async () => {
    const owner = await criarUsuario('vizinho@brabo.dev');
    const a = await criarWorkspace(owner.id, 'ws-sino-a');
    const b = await criarWorkspace(owner.id, 'ws-sino-b');
    const doA = await criarProjeto(a.id, owner.id, 'core');
    const doB = await criarProjeto(b.id, owner.id, 'core');
    const sa = await criarSessao(doA.id, owner.id);
    const sb = await criarSessao(doB.id, owner.id);
    const eventoDoA = await gravarEvento(sa.id, 'chat.message');
    await gravarEvento(sb.id, 'chat.message');

    // O cursor do vizinho vem do `localStorage` de quem chama e pode ser
    // sobra de outro workspace — é descartado, não é erro.
    const grupos = await repo.unreadEventsForWorkspace(a.id, [
      { projectId: doA.id, afterSeq: 0 },
      { projectId: doB.id, afterSeq: 0 },
    ]);

    expect(grupos.map((g) => g.projectId)).toEqual([doA.id]);
    expect(grupos[0].events.map((e) => e.id)).toEqual([eventoDoA.id]);
  });

  it('lê a sessão MAIS RECENTE, a mesma que o resumo reporta', async () => {
    const owner = await criarUsuario('recente-sino@brabo.dev');
    const ws = await criarWorkspace(owner.id, 'recente-sino');
    const projeto = await criarProjeto(ws.id, owner.id, 'core');

    const antiga = await criarSessao(projeto.id, owner.id);
    await db
      .update(sessions)
      .set({ createdAt: new Date(Date.now() - 60_000) })
      .where(sql`${sessions.id} = ${antiga.id}`);
    const recente = await criarSessao(projeto.id, owner.id);

    await gravarEvento(antiga.id, 'chat.message');
    const novo = await gravarEvento(recente.id, 'agent.response');

    const [grupo] = await repo.unreadEventsForWorkspace(ws.id, [
      { projectId: projeto.id, afterSeq: 0 },
    ]);
    const [resumo] = await repo.summarizeForWorkspace(ws.id);

    expect(grupo.sessionId).toBe(recente.id);
    expect(grupo.sessionId).toBe(resumo.latestSessionId);
    expect(grupo.events.map((e) => e.id)).toEqual([novo.id]);
  });

  /**
   * O teto é POR PROJETO, não da resposta inteira. Um `limit` no fim da
   * consulta devolveria o mesmo total e deixaria o projeto barulhento comer a
   * cota dos calados — que é justamente o caso em que a gaveta importa.
   */
  it('o teto de 50 eventos vale por projeto, não para a resposta toda', async () => {
    const owner = await criarUsuario('teto@brabo.dev');
    const ws = await criarWorkspace(owner.id, 'teto');
    const barulhento = await criarProjeto(ws.id, owner.id, 'barulhento');
    const calado = await criarProjeto(ws.id, owner.id, 'calado');
    const sb = await criarSessao(barulhento.id, owner.id);
    const sc = await criarSessao(calado.id, owner.id);

    for (let i = 0; i < 60; i++) await gravarEvento(sb.id, 'chat.message');
    const doCalado = await gravarEvento(sc.id, 'chat.message');

    const grupos = await repo.unreadEventsForWorkspace(ws.id, [
      { projectId: barulhento.id, afterSeq: 0 },
      { projectId: calado.id, afterSeq: 0 },
    ]);
    const porProjeto = new Map(grupos.map((g) => [g.projectId, g]));

    expect(porProjeto.get(barulhento.id)?.events).toHaveLength(50);
    expect(porProjeto.get(calado.id)?.events.map((e) => e.id)).toEqual([
      doCalado.id,
    ]);
  });

  /**
   * RN-100 — a ordem do sino é do SQL, e o teto é o motivo.
   *
   * São DUAS afirmações, e a segunda é a que um `.sort()` no front não
   * alcançaria: a função de janela decide QUAIS 50 eventos sobrevivem ao teto,
   * não só em que ordem eles saem. Com `ORDER BY e.seq ASC` lá dentro, um
   * projeto com 60 não lidos devolvia os 50 mais ANTIGOS — e ordenar isso por
   * recência no cliente mostraria o 11º evento como "o mais recente do
   * projeto", que é a mentira exata que o usuário viu na tela.
   *
   * Por isso o teste afirma o CONJUNTO (os 10 mais novos estão dentro, os 10
   * mais antigos estão fora) antes de afirmar a ordenação.
   */
  it('com mais não lidos que o teto, voltam os MAIS RECENTES, do novo para o velho', async () => {
    const owner = await criarUsuario('recencia@brabo.dev');
    const ws = await criarWorkspace(owner.id, 'recencia');
    const projeto = await criarProjeto(ws.id, owner.id, 'core');
    const sessao = await criarSessao(projeto.id, owner.id);

    const todos: { seq: number }[] = [];
    for (let i = 0; i < 60; i++) {
      todos.push(await gravarEvento(sessao.id, 'chat.message'));
    }

    const [grupo] = await repo.unreadEventsForWorkspace(ws.id, [
      { projectId: projeto.id, afterSeq: 0 },
    ]);

    const seqs = grupo.events.map((e) => e.seq);
    expect(seqs).toHaveLength(50);

    // O CONJUNTO: a janela é a cauda, não a cabeça.
    expect(seqs[0]).toBe(todos[59].seq);
    expect(seqs).toContain(todos[10].seq);
    expect(seqs).not.toContain(todos[9].seq);
    expect(seqs).not.toContain(todos[0].seq);

    // A ORDEM: decrescente, sem depender de nada no cliente.
    expect([...seqs].sort((a, b) => b - a)).toEqual(seqs);
  });

  /**
   * A propriedade que a PR inteira depende, e o irmão do teste de consultas
   * do resumo: 20 projetos custam o MESMO que 2.
   *
   * Um `for (const cursor of cursors)` aqui dentro devolveria dados idênticos
   * e passaria em todos os testes acima — trocaria N+1 de HTTP por N+1 de SQL.
   * Por isso este conta idas ao banco em vez de olhar o resultado, e afirma
   * IGUALDADE em vez de um número fixo (que passaria de novo com o laço de
   * volta e dois projetos na fixture).
   */
  it('o número de consultas NÃO cresce com a quantidade de projetos', async () => {
    const contarConsultas = async (n: number): Promise<number> => {
      await truncateAll(db);
      const owner = await criarUsuario(`sino-escala-${n}@brabo.dev`);
      const ws = await criarWorkspace(owner.id, `sino-escala-${n}`);
      const cursores: { projectId: string; afterSeq: number }[] = [];
      for (let i = 0; i < n; i++) {
        const p = await criarProjeto(ws.id, owner.id, `p-${i}`);
        const s = await criarSessao(p.id, owner.id);
        await gravarEvento(s.id, 'chat.message');
        cursores.push({ projectId: p.id, afterSeq: 0 });
      }

      const original = pool.query.bind(pool);
      let consultas = 0;
      (pool as { query: unknown }).query = (...args: unknown[]) => {
        consultas += 1;
        return (original as (...a: unknown[]) => unknown)(...args);
      };
      try {
        const grupos = await repo.unreadEventsForWorkspace(ws.id, cursores);
        expect(grupos).toHaveLength(n);
      } finally {
        (pool as { query: unknown }).query = original;
      }
      return consultas;
    };

    const comDois = await contarConsultas(2);
    const comVinte = await contarConsultas(20);

    expect(comVinte).toBe(comDois);
    expect(comDois).toBeGreaterThan(0);
  });
});
