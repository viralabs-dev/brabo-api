import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { eq, isNull, and } from 'drizzle-orm';
import neo4j, { type Driver } from 'neo4j-driver';
import { ulid } from 'ulid';
import { createTestDb, truncateAll } from '../support/test-db';
import {
  outboxEvents,
  projects,
  sessionEvents,
  sessions,
  users,
  workspaces,
} from '../../src/db/schema';
import {
  ProjetoInexistenteError,
  lerArgumentos,
  reprojetarGrafo,
} from '../../src/scripts/reprojetar-grafo';
import { GraphStore } from '../../src/infrastructure/graph/graph-store';
import { GraphUnavailableError } from '../../src/domain/graph/graph-errors';
import {
  EVENTOS_DO_LOG_PROJETAVEIS,
  FECHAMENTOS_DE_SESSAO,
} from '../../src/application/graph-projection/graph-event-translator';
import { GRAPH_PROJECTABLE_EVENT_TYPES } from '../../src/domain/graph/graph-projection-events';
import { GraphProjector } from '../../src/application/graph-projection/graph-projector';
import { DrizzleOutboxRepository } from '../../src/infrastructure/persistence/drizzle/outbox.repository';
import { DrizzleSessionEventRepository } from '../../src/infrastructure/persistence/drizzle/session-event.repository';
import { DrizzleSessionRepository } from '../../src/infrastructure/persistence/drizzle/session.repository';
import { RecordHandoffUseCase } from '../../src/application/use-cases/graph/record-handoff.use-case';
import { RecordHypothesisUseCase } from '../../src/application/use-cases/graph/record-hypothesis.use-case';
import { RecordAnamneseProfileUseCase } from '../../src/application/use-cases/graph/record-anamnese-profile.use-case';
import { RecordInteractionUseCase } from '../../src/application/use-cases/graph/record-interaction.use-case';

/**
 * A reprojeção do grafo a partir do event log (BRB-018, RN-569).
 *
 * O que este arquivo prova é o que distingue *reconstruiu* de *rodou sem
 * erro*: o grafo que o projetor PARA FRENTE produz é medido (contagem de nós e
 * arestas, e a lista das chaves), APAGADO, reprojetado, e medido de novo — e
 * uma segunda reprojeção por cima dá o mesmo grafo.
 *
 * ## Neo4j de verdade, e o grafo de dev intacto
 *
 * Postgres é o banco de teste por worker (`test/support/test-db.ts`). Neo4j é
 * o do compose de dev — o mesmo molde de `neo4j-integration.spec.ts`: sem
 * Neo4j alcançável, os testes que dependem dele PULAM (a CI do api não sobe
 * Neo4j, então lá eles pulam; rodar em CI é a HS-023). Por ser o grafo de
 * quem desenvolve, "apagar o grafo" aqui é apagar o SUBGRAFO deste cenário:
 * todo id nasce aleatório por teste (usuário, projetos, sessões e os slugs de
 * agente), e a contagem e a remoção são escopadas a eles. Nenhum nó de fora
 * do cenário é tocado.
 *
 * Para rodar de propósito, com o compose de pé:
 * `pnpm --filter api test -- test/scripts/reprojetar-grafo.spec.ts`
 */

const URI = process.env.NEO4J_URI ?? 'bolt://localhost:7687';
const USER = process.env.NEO4J_USER ?? 'neo4j';
// Default = o do `NEO4J_AUTH` do compose de dev (docker/docker-compose.yml).
const PASSWORD = process.env.NEO4J_PASSWORD ?? 'dev-neo4j-password-change-me';

const { db, pool } = createTestDb();

async function neo4jAlcancavel(): Promise<boolean> {
  let driver: Driver | undefined;
  try {
    driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD));
    await Promise.race([
      driver.verifyConnectivity(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout de 2s')), 2000),
      ),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    await driver?.close();
  }
}

interface Cenario {
  usuarios: string[];
  projetos: string[];
  sessoes: string[];
  slugs: string[];
  projetoA: string;
  sessaoB: string;
}

/**
 * Semeia o event log como os casos de uso de produção deixam: o evento em
 * `session_events` e, na mesma forma, a linha `graph_projection` da outbox
 * (`append-session-event.use-case.ts` grava `{eventId}`;
 * `transition-session.use-case.ts` grava `{sessionId, projectId}`).
 *
 * - sessão A1 (projeto A, `closed`): uma mensagem, um handoff X→Y, uma
 *   hipótese com a mensagem de evidência, um perfil da Anamnese
 * - sessão A2 (projeto A, `active`): um handoff Y→Z — sem `Interacao`
 * - sessão B1 (projeto B, `closed_abnormally`): um handoff X→Z
 */
async function semear(): Promise<Cenario> {
  const sufixo = randomBytes(6).toString('hex');
  const [dono] = await db
    .insert(users)
    .values({
      keycloakSub: `sub-repro-${sufixo}`,
      email: `repro-${sufixo}@brabo.dev`,
    })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: `acme-${sufixo}`, createdBy: dono.id })
    .returning();
  const [projetoA, projetoB] = await db
    .insert(projects)
    .values([
      {
        workspaceId: ws.id,
        name: 'a',
        slug: `a-${sufixo}`,
        createdBy: dono.id,
      },
      {
        workspaceId: ws.id,
        name: 'b',
        slug: `b-${sufixo}`,
        createdBy: dono.id,
      },
    ])
    .returning();

  const slugX = `repro-${sufixo}-x`;
  const slugY = `repro-${sufixo}-y`;
  const slugZ = `repro-${sufixo}-z`;

  async function sessao(
    projectId: string,
    status: 'active' | 'closed' | 'closed_abnormally',
    eventos: {
      type: string;
      actorId: string;
      payload: (ids: string[]) => unknown;
    }[],
  ): Promise<string> {
    const [s] = await db
      .insert(sessions)
      .values({
        projectId,
        createdBy: dono.id,
        status,
        nextSeq: eventos.length + 1,
        closedAt: status === 'active' ? null : new Date(),
      })
      .returning();
    const ids: string[] = [];
    for (const [i, e] of eventos.entries()) {
      const id = ulid();
      ids.push(id);
      await db.insert(sessionEvents).values({
        id,
        sessionId: s.id,
        seq: i + 1,
        type: e.type,
        actorKind: e.actorId === dono.id ? 'user' : 'agent',
        actorId: e.actorId,
        payload: e.payload(ids),
      });
      if (GRAPH_PROJECTABLE_EVENT_TYPES.has(e.type)) {
        await db.insert(outboxEvents).values({
          aggregateType: 'graph_projection',
          aggregateId: s.id,
          eventType: e.type,
          payload: { eventId: id },
        });
      }
    }
    if (status !== 'active') {
      await db.insert(outboxEvents).values({
        aggregateType: 'graph_projection',
        aggregateId: s.id,
        eventType: `session.${status}`,
        payload: { sessionId: s.id, projectId },
      });
    }
    return s.id;
  }

  const a1 = await sessao(projetoA.id, 'closed', [
    { type: 'user.message', actorId: dono.id, payload: () => ({ text: 'oi' }) },
    {
      type: 'handoff.offered',
      actorId: slugX,
      payload: () => ({ toAgent: slugY }),
    },
    {
      type: 'psychologist.hypothesis_proposed',
      actorId: 'psicologo',
      payload: (ids) => ({
        hypothesisId: randomUUID(),
        hipotese: 'o PO pergunta demais',
        evidenceEventIds: [ids[0]],
      }),
    },
    {
      type: 'anamnese.profile_updated',
      actorId: 'anamnese',
      payload: () => ({
        userId: dono.id,
        competency: `nestjs-${sufixo}`,
        level: 'senior',
      }),
    },
  ]);
  const a2 = await sessao(projetoA.id, 'active', [
    {
      type: 'handoff.offered',
      actorId: slugY,
      payload: () => ({ toAgent: slugZ }),
    },
  ]);
  const b1 = await sessao(projetoB.id, 'closed_abnormally', [
    {
      type: 'handoff.offered',
      actorId: slugX,
      payload: () => ({ toAgent: slugZ }),
    },
  ]);

  return {
    usuarios: [dono.id],
    projetos: [projetoA.id, projetoB.id],
    sessoes: [a1, a2, b1],
    slugs: [slugX, slugY, slugZ],
    projetoA: projetoA.id,
    sessaoB: b1,
  };
}

/** Os nós deste cenário, e só eles, na variável Cypher `v`. */
function doCenario(v: string): string {
  return `
    (${v}:Usuario AND ${v}.id IN $usuarios)
    OR (${v}:Projeto AND ${v}.id IN $projetos)
    OR (${v}:Agente AND ${v}.slug IN $slugs)
    OR ((${v}:Handoff OR ${v}:Hipotese OR ${v}:Evento OR ${v}:Interacao) AND ${v}.sessionId IN $sessoes)
    OR (${v}:PerfilAnamnese AND ${v}.userId IN $usuarios)
  `;
}

interface Medida {
  nos: number;
  arestas: number;
  /** Rótulo + chave natural de cada nó, e tipo de cada aresta — ordenados. */
  assinatura: string[];
}

async function medir(grafo: GraphStore, c: Cenario): Promise<Medida> {
  return grafo.executeRead(async (tx) => {
    const nos = await tx.run(
      `MATCH (n) WHERE ${doCenario('n')}
       RETURN labels(n)[0] + ':' + coalesce(n.id, n.slug, n.sessionId + '#' + toString(n.seq),
              n.sessionId, n.userId + '/' + n.dimensao) AS chave`,
      { ...c },
    );
    const arestas = await tx.run(
      `MATCH (a)-[r]->() WHERE ${doCenario('a')}
       RETURN type(r) AS tipo`,
      { ...c },
    );
    const chaves = nos.records.map((r) => r.get<string>('chave'));
    const tipos = arestas.records.map((r) => `-${r.get<string>('tipo')}->`);
    return {
      nos: chaves.length,
      arestas: tipos.length,
      assinatura: [...chaves, ...tipos].sort(),
    };
  });
}

async function apagar(grafo: GraphStore, c: Cenario): Promise<void> {
  await grafo.executeWrite((tx) =>
    tx.run(`MATCH (n) WHERE ${doCenario('n')} DETACH DELETE n`, { ...c }),
  );
}

async function projetarParaFrente(grafo: GraphStore): Promise<void> {
  const sessionEventsRepo = new DrizzleSessionEventRepository(db);
  const projetor = new GraphProjector(
    new DrizzleOutboxRepository(db),
    sessionEventsRepo,
    new DrizzleSessionRepository(db),
    new RecordHandoffUseCase(grafo),
    new RecordHypothesisUseCase(grafo),
    new RecordAnamneseProfileUseCase(grafo),
    new RecordInteractionUseCase(grafo),
  );
  await projetor.drainOnce();
  const pendentes = await db
    .select()
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.aggregateType, 'graph_projection'),
        isNull(outboxEvents.processedAt),
      ),
    );
  expect(pendentes).toHaveLength(0);
}

const silencio = { progresso: () => {}, reportarFalha: () => {} };

describe('reprojeção do grafo a partir do event log (RN-569)', () => {
  let grafo: GraphStore;
  let alcancavel = false;
  let cenario: Cenario | undefined;

  beforeAll(async () => {
    alcancavel = await neo4jAlcancavel();
    if (!alcancavel) {
      console.warn(
        `[integração] Neo4j não alcançável em ${URI} — pulando as provas da ` +
          'reprojeção que dependem do grafo. Suba o compose (`docker compose ' +
          'up -d neo4j`) para exercitá-las.',
      );
      return;
    }
    process.env.NEO4J_URI = URI;
    process.env.NEO4J_USER = USER;
    process.env.NEO4J_PASSWORD = PASSWORD;
    grafo = new GraphStore();
    await grafo.onModuleInit();
  }, 20_000);

  beforeEach(async () => {
    if (cenario && alcancavel) await apagar(grafo, cenario);
    cenario = undefined;
    await truncateAll(db);
  });

  afterAll(async () => {
    if (cenario && alcancavel) await apagar(grafo, cenario);
    await grafo?.onModuleDestroy();
    await pool.end();
  });

  it('apaga, reprojeta o log inteiro e chega ao MESMO grafo do projetor para frente; a segunda rodada não muda nada', async (ctx) => {
    if (!alcancavel) return ctx.skip();
    const c = await semear();
    cenario = c;

    await projetarParaFrente(grafo);
    const paraFrente = await medir(grafo, c);
    // Usuario 1, Projeto 2, Agente 3, Handoff 3, Hipotese 1, Evento 1,
    // Interacao 2 (A2 está ativa), PerfilAnamnese 1.
    expect(paraFrente.nos).toBe(14);
    // DE+PARA ×3, EVIDENCIA, SOBRE, PARTICIPOU ×2, NO_PROJETO ×2.
    expect(paraFrente.arestas).toBe(12);

    await apagar(grafo, c);
    expect(await medir(grafo, c)).toEqual({
      nos: 0,
      arestas: 0,
      assinatura: [],
    });

    const outboxAntes = await db.select().from(outboxEvents);

    // Lote de 2 força a varredura a atravessar vários lotes pelo cursor.
    const primeira = await reprojetarGrafo(db, grafo, {
      ...silencio,
      tamanhoDoLote: 2,
    });
    expect(primeira).toMatchObject({
      eventosProjetados: 5,
      fechamentosProjetados: 2,
      falhas: 0,
    });
    expect(await medir(grafo, c)).toEqual(paraFrente);

    const segunda = await reprojetarGrafo(db, grafo, {
      ...silencio,
      tamanhoDoLote: 2,
    });
    expect(segunda).toEqual(primeira);
    expect(await medir(grafo, c)).toEqual(paraFrente);

    // O projetor vivo guarda o progresso na outbox, e a reprojeção não a toca.
    expect(await db.select().from(outboxEvents)).toEqual(outboxAntes);
  });

  it('por projeto: reprojeta só as sessões do projeto pedido', async (ctx) => {
    if (!alcancavel) return ctx.skip();
    const c = await semear();
    cenario = c;

    const resultado = await reprojetarGrafo(db, grafo, {
      ...silencio,
      projectId: c.projetoA,
    });
    expect(resultado).toMatchObject({
      eventosProjetados: 4,
      fechamentosProjetados: 1,
      falhas: 0,
    });

    const medida = await medir(grafo, c);
    // Usuario, Projeto A, Agentes X/Y/Z, Handoff ×2, Hipotese, Evento,
    // Interacao de A1, PerfilAnamnese.
    expect(medida.nos).toBe(11);
    expect(medida.arestas).toBe(8);
    expect(medida.assinatura.some((k) => k.includes(c.sessaoB))).toBe(false);
  });

  it('projeto inexistente é recusado NOMEADO, e nada é gravado', async (ctx) => {
    if (!alcancavel) return ctx.skip();
    const c = await semear();
    cenario = c;

    await expect(
      reprojetarGrafo(db, grafo, { ...silencio, projectId: randomUUID() }),
    ).rejects.toBeInstanceOf(ProjetoInexistenteError);
    await expect(
      reprojetarGrafo(db, grafo, { ...silencio, projectId: 'meu-slug' }),
    ).rejects.toBeInstanceOf(ProjetoInexistenteError);

    expect((await medir(grafo, c)).nos).toBe(0);
  });

  it('grafo indisponível é erro nomeado ANTES de ler o log — nunca sucesso calado com zero projetados', async () => {
    // Sem `onModuleInit`, o GraphStore fica sem driver — o mesmo estado de
    // NEO4J_* ausente ou conexão recusada. Não depende de Neo4j de pé.
    const desligado = new GraphStore();
    await expect(
      reprojetarGrafo(db, desligado, silencio),
    ).rejects.toBeInstanceOf(GraphUnavailableError);
  });

  it('argumento desconhecido é recusado com o uso, em vez de reprojetar o log inteiro', () => {
    expect(lerArgumentos(['--project', 'p1', '--after-event', 'e1'])).toEqual({
      projectId: 'p1',
      aposEvento: 'e1',
    });
    // O `--` que o pnpm repassa ao script é separador, não argumento.
    expect(lerArgumentos(['--', '--project', 'p1'])).toEqual({ projectId: 'p1' });
    expect(() => lerArgumentos(['--projeto', 'p1'])).toThrow(/não reconhecido/);
    expect(() => lerArgumentos(['--project'])).toThrow(/não reconhecido/);
  });

  it('o tradutor cobre exatamente os tipos que ganham linha de projeção', () => {
    // Tipo novo em GRAPH_PROJECTABLE_EVENT_TYPES sem tradução faria o projetor
    // para frente e a reprojeção divergirem calados.
    expect(
      new Set([...EVENTOS_DO_LOG_PROJETAVEIS, ...FECHAMENTOS_DE_SESSAO]),
    ).toEqual(GRAPH_PROJECTABLE_EVENT_TYPES);
  });
});
