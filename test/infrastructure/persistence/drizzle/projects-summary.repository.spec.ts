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

async function criarProjeto(workspaceId: string, ownerId: string, slug: string) {
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
      roster: {
        executionActivated: false,
        moduleNames: [],
        gatesEverOpened: false,
        delegatedSubagents: [],
        infraActive: false,
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
    expect(resumo.roster).toEqual({
      executionActivated: true,
      moduleNames: ['api'],
      gatesEverOpened: true,
      delegatedSubagents: ['qa-automacao'],
      infraActive: true,
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
