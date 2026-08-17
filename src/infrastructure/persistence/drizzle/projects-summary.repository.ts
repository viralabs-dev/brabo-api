import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  ProjectsSummaryRepository,
  UNREAD_EVENTS_POR_PROJETO,
  type ProjectCardSummary,
  type ProjectUnreadEvents,
  type RosterFacts,
  type UnreadCursor,
} from '../../../application/ports/projects-summary-repository.port';
import { deriveProvisioningStatus } from '../../../domain/git/repo-bootstrap-status';
import type { BootstrapPlan } from '../../../domain/git/repo-bootstrap.entity';
import type { SessionEvent } from '../../../domain/sessions/session-event.entity';
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
  stories,
} from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

/**
 * Read model do dashboard em DOZE consultas escopadas por workspace: duas em
 * sequência (os projetos, e a sessão mais recente de cada um) e dez em
 * paralelo sobre esses dois conjuntos de ids.
 *
 * Doze é CONSTANTE — nenhuma roda dentro de laço sobre projetos, e é essa a
 * propriedade que a suíte prova: `projects-summary.repository.spec.ts` conta
 * idas ao banco com 2 e com 20 projetos e exige o mesmo número. Sem esse
 * teste, um laço aqui devolveria dados idênticos e trocaria o N+1 de HTTP por
 * um N+1 de SQL, que é o mesmo defeito num andar mais barato.
 *
 * O caminho anterior fazia SETE requisições HTTP em poll POR CARD.
 *
 * `unreadEventsForWorkspace` é a segunda metade do mesmo read model, sob a
 * mesma disciplina: DUAS consultas, quantos projetos forem.
 */
@Injectable()
export class DrizzleProjectsSummaryRepository implements ProjectsSummaryRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async summarizeForWorkspace(
    workspaceId: string,
  ): Promise<ProjectCardSummary[]> {
    const db = currentDb(this.rootDb);

    const projectRows = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.workspaceId, workspaceId));

    const projectIds = projectRows.map((r) => r.id);
    if (projectIds.length === 0) return [];

    // A sessão mais recente de cada projeto — `distinct on` resolve no banco o
    // que o cliente fazia baixando TODAS as sessões de cada projeto e
    // ordenando em memória.
    const latestSessions = await db
      .selectDistinctOn([sessions.projectId], {
        projectId: sessions.projectId,
        sessionId: sessions.id,
        nextSeq: sessions.nextSeq,
      })
      .from(sessions)
      .where(inArray(sessions.projectId, projectIds))
      .orderBy(sessions.projectId, desc(sessions.createdAt));

    const sessionIds = latestSessions.map((s) => s.sessionId);

    const [
      repos,
      bootstraps,
      budgetRows,
      maps,
      promocoes,
      pendencias,
      lastEvents,
      marcos,
      infraHandoffs,
      staffHandoffs,
      delegados,
    ] = await Promise.all([
      db
        .select({
          projectId: projectRepositories.projectId,
          provider: projectRepositories.provider,
        })
        .from(projectRepositories)
        .where(inArray(projectRepositories.projectId, projectIds)),

      db
        .select()
        .from(repoBootstraps)
        .where(inArray(repoBootstraps.projectId, projectIds)),

      db
        .select({
          projectId: budgets.projectId,
          limitMicros: budgets.limitMicros,
          spentMicros: budgets.spentMicros,
        })
        .from(budgets)
        .where(inArray(budgets.projectId, projectIds)),

      // module_map VIGENTE por projeto (maior `version`) — mesma regra de
      // `DrizzleModuleMapRepository.findCurrent`, em lote.
      db
        .selectDistinctOn([moduleMaps.projectId], {
          projectId: moduleMaps.projectId,
          modules: moduleMaps.modules,
        })
        .from(moduleMaps)
        .where(inArray(moduleMaps.projectId, projectIds))
        .orderBy(moduleMaps.projectId, desc(moduleMaps.version)),

      db
        .select({
          projectId: stories.projectId,
          total: sql<number>`count(*)::int`,
        })
        .from(stories)
        .where(
          and(
            inArray(stories.projectId, projectIds),
            eq(stories.proposedReady, true),
          ),
        )
        .groupBy(stories.projectId),

      // Ações propostas ainda por decidir, no projeto INTEIRO — todas as
      // sessões, não só a mais recente (RN-151). É o número que o badge da
      // sidebar mostra; mesmo formato agregado de `promocoes` acima.
      db
        .select({
          projectId: proposedActions.projectId,
          total: sql<number>`count(*)::int`,
        })
        .from(proposedActions)
        .where(
          and(
            inArray(proposedActions.projectId, projectIds),
            eq(proposedActions.status, 'pending'),
          ),
        )
        .groupBy(proposedActions.projectId),

      // Último evento de cada sessão — o card mostra UMA linha de atividade,
      // então trazer uma linha por sessão é o pedido exato.
      //
      // As quatro consultas por sessão não são guardadas por
      // `sessionIds.length === 0`: `inArray` com lista vazia vira `false` no
      // SQL, devolve zero linhas na hora, e a contagem de idas ao banco fica
      // constante de verdade — inclusive no projeto que nunca abriu sessão.
      db
        .selectDistinctOn([sessionEvents.sessionId], {
          id: sessionEvents.id,
          sessionId: sessionEvents.sessionId,
          seq: sessionEvents.seq,
          type: sessionEvents.type,
          actorKind: sessionEvents.actorKind,
          actorId: sessionEvents.actorId,
          payload: sessionEvents.payload,
          createdAt: sessionEvents.createdAt,
        })
        .from(sessionEvents)
        .where(inArray(sessionEvents.sessionId, sessionIds))
        .orderBy(sessionEvents.sessionId, desc(sessionEvents.seq)),

      // Os dois marcos que decidem presença na roster, agregados no banco:
      // varrer os eventos no cliente exigia baixá-los todos.
      db
        .select({
          sessionId: sessionEvents.sessionId,
          executionActivated: sql<boolean>`bool_or(${sessionEvents.type} = 'execution.activated')`,
          gatesEverOpened: sql<boolean>`bool_or(${sessionEvents.type} in ('pr.gate_changed', 'infra.gate_changed'))`,
        })
        .from(sessionEvents)
        .where(inArray(sessionEvents.sessionId, sessionIds))
        .groupBy(sessionEvents.sessionId),

      db
        .selectDistinct({ sessionId: handoffs.sessionId })
        .from(handoffs)
        .where(
          and(
            inArray(handoffs.sessionId, sessionIds),
            eq(handoffs.toAgent, 'infra'),
            eq(handoffs.status, 'accepted'),
          ),
        ),

      // Staff (docs/fluxo.yml, ADR 0088) — mesmo critério de `infraHandoffs`
      // acima: dormente para disparo automático (a Anamnese está pausada),
      // presente aqui só por ativação MANUAL já aceita.
      db
        .selectDistinct({ sessionId: handoffs.sessionId })
        .from(handoffs)
        .where(
          and(
            inArray(handoffs.sessionId, sessionIds),
            eq(handoffs.toAgent, 'staff'),
            eq(handoffs.status, 'accepted'),
          ),
        ),

      db
        .selectDistinct({
          sessionId: delegations.sessionId,
          subagent: delegations.subagent,
        })
        .from(delegations)
        .where(inArray(delegations.sessionId, sessionIds)),
    ]);

    const providerDe = indexarPor(repos, (r) => r.projectId);
    const bootstrapDe = indexarPor(bootstraps, (r) => r.projectId);
    const budgetDe = indexarPor(budgetRows, (r) => r.projectId);
    const modulosDe = indexarPor(maps, (r) => r.projectId);
    const promocaoDe = indexarPor(promocoes, (r) => r.projectId);
    const pendenciasDe = indexarPor(pendencias, (r) => r.projectId);

    const sessaoDe = indexarPor(latestSessions, (s) => s.projectId);
    const ultimoEventoDe = indexarPor(lastEvents, (e) => e.sessionId);
    const marcosDe = indexarPor(marcos, (m) => m.sessionId);
    const infraAtivoEm = new Set(infraHandoffs.map((h) => h.sessionId));
    const staffAtivoEm = new Set(staffHandoffs.map((h) => h.sessionId));
    const subagentesDe = new Map<string, string[]>();
    for (const d of delegados) {
      const lista = subagentesDe.get(d.sessionId) ?? [];
      lista.push(d.subagent);
      subagentesDe.set(d.sessionId, lista);
    }

    return projectIds.map((projectId) => {
      const sessao = sessaoDe.get(projectId);
      const sessionId = sessao?.sessionId ?? null;
      const evento = sessionId ? ultimoEventoDe.get(sessionId) : undefined;
      const marco = sessionId ? marcosDe.get(sessionId) : undefined;
      const budget = budgetDe.get(projectId);
      const bootstrapRow = bootstrapDe.get(projectId);

      const roster: RosterFacts = {
        executionActivated: marco?.executionActivated ?? false,
        moduleNames: (modulosDe.get(projectId)?.modules ?? []).map(
          (m) => m.name,
        ),
        gatesEverOpened: marco?.gatesEverOpened ?? false,
        delegatedSubagents: sessionId
          ? (subagentesDe.get(sessionId) ?? [])
          : [],
        infraActive: sessionId ? infraAtivoEm.has(sessionId) : false,
        staffActive: sessionId ? staffAtivoEm.has(sessionId) : false,
      };

      return {
        projectId,
        provider: providerDe.get(projectId)?.provider ?? 'local',
        provisioningStatus: deriveProvisioningStatus(
          bootstrapRow
            ? {
                ...bootstrapRow,
                plan: (bootstrapRow.plan as BootstrapPlan | null) ?? null,
              }
            : null,
        ),
        budget: budget
          ? { limitMicros: budget.limitMicros, spentMicros: budget.spentMicros }
          : null,
        latestSessionId: sessionId,
        // `nextSeq - 1` é o último seq JÁ gravado — mesma conta que o cliente
        // fazia para descobrir quantos eventos não lidos existem.
        latestSeq: sessao ? sessao.nextSeq - 1 : 0,
        lastEvent: evento ? toEvent(evento) : null,
        storiesAwaitingPromotion: promocaoDe.get(projectId)?.total ?? 0,
        pendingApprovalsCount: pendenciasDe.get(projectId)?.total ?? 0,
        roster,
      };
    });
  }

  /**
   * A gaveta do sino inteira em DUAS consultas, quantos projetos forem
   * (RN-091), do MAIS RECENTE para o mais antigo (RN-100).
   *
   * A primeira resolve a sessão mais recente de cada projeto PEDIDO — com
   * `join` em `projects` filtrando por workspace, que é o mesmo passo que
   * descarta cursor de projeto alheio. A segunda traz os eventos das N sessões
   * de uma vez: os cortes entram como uma tabela `VALUES` no `join`, e
   * `row_number()` aplica o teto POR SESSÃO, que é o que um `limit` no fim não
   * conseguiria (ele cortaria a resposta inteira, e um projeto barulhento
   * comeria a cota dos outros).
   *
   * O `DESC` das duas ordenações é a correção da RN-100, e ele é do SQL por
   * necessidade, não por gosto: a função de janela decide QUAIS 50 eventos
   * sobrevivem ao teto. Com `ASC` sobreviviam os 50 mais ANTIGOS não lidos, e
   * um `.sort()` no cliente ordenaria por recência justamente os que a
   * consulta já tinha escolhido errado — mostrando o 51º evento mais antigo
   * como se fosse o mais novo do projeto.
   *
   * Raw SQL aqui, e não query builder, por causa dessas duas peças — `VALUES`
   * correlacionado e função de janela. A alternativa em builder seria um laço
   * sobre as sessões, que é o N+1 que esta chamada existe para matar.
   */
  async unreadEventsForWorkspace(
    workspaceId: string,
    cursors: UnreadCursor[],
  ): Promise<ProjectUnreadEvents[]> {
    // Mapa vazio devolve vazio, sem ir ao banco: "não perguntei nada" não é
    // "me dê tudo". O `Map` também desduplica projeto repetido, que de outro
    // modo apareceria duas vezes no `VALUES` e duplicaria os eventos dele.
    const corteDe = new Map(cursors.map((c) => [c.projectId, c.afterSeq]));
    if (corteDe.size === 0) return [];

    const db = currentDb(this.rootDb);
    const projectIds = [...corteDe.keys()];

    const latestSessions = await db
      .selectDistinctOn([sessions.projectId], {
        projectId: sessions.projectId,
        sessionId: sessions.id,
      })
      .from(sessions)
      .innerJoin(projects, eq(projects.id, sessions.projectId))
      .where(
        and(
          eq(projects.workspaceId, workspaceId),
          inArray(sessions.projectId, projectIds),
        ),
      )
      .orderBy(sessions.projectId, desc(sessions.createdAt));

    if (latestSessions.length === 0) return [];

    const cortes = sql.join(
      latestSessions.map(
        (s) => sql`(${s.sessionId}::uuid, ${corteDe.get(s.projectId)!}::int)`,
      ),
      sql`, `,
    );

    const eventos = await db.execute(sql`
      SELECT id, session_id, seq, type, actor_kind, actor_id, payload, created_at
      FROM (
        SELECT e.*,
               row_number() OVER (
                 PARTITION BY e.session_id ORDER BY e.seq DESC
               ) AS rn
        FROM session_events e
        JOIN (VALUES ${cortes}) AS c(session_id, after_seq)
          ON e.session_id = c.session_id AND e.seq > c.after_seq
      ) t
      WHERE t.rn <= ${UNREAD_EVENTS_POR_PROJETO}
      ORDER BY t.session_id, t.seq DESC
    `);

    const porSessao = new Map<string, SessionEvent[]>();
    for (const linha of eventos.rows) {
      const evento = toEvent(paraColunas(linha));
      const lista = porSessao.get(evento.sessionId) ?? [];
      lista.push(evento);
      porSessao.set(evento.sessionId, lista);
    }

    const sessaoDe = indexarPor(latestSessions, (s) => s.projectId);

    // Na ordem em que os cursores chegaram, e sem projeto que não tenha nada:
    // grupo com zero eventos viraria um cabeçalho vazio na gaveta.
    return projectIds.flatMap((projectId) => {
      const sessao = sessaoDe.get(projectId);
      if (!sessao) return [];
      const events = porSessao.get(sessao.sessionId) ?? [];
      if (events.length === 0) return [];
      return [{ projectId, sessionId: sessao.sessionId, events }];
    });
  }
}

/**
 * `db.execute` devolve as colunas CRUAS (snake_case), sem o mapeamento
 * camelCase do Drizzle — mesma conversão manual que `claimNext` faz em
 * `backlog.repository.ts`.
 */
function paraColunas(linha: Record<string, unknown>) {
  return {
    id: linha.id as string,
    sessionId: linha.session_id as string,
    seq: Number(linha.seq),
    type: linha.type as string,
    actorKind: linha.actor_kind as SessionEvent['actor']['kind'],
    actorId: linha.actor_id as string,
    payload: linha.payload,
    createdAt: linha.created_at as Date,
  };
}

/**
 * Uma linha por chave. Toda consulta acima já devolve no máximo uma linha por
 * projeto/sessão (unique, `group by` ou `distinct on`), então indexar é só
 * trocar busca linear por acesso direto — não é deduplicação.
 */
function indexarPor<T, K>(linhas: T[], chave: (linha: T) => K): Map<K, T> {
  return new Map(linhas.map((linha) => [chave(linha), linha]));
}

function toEvent(row: {
  id: string;
  sessionId: string;
  seq: number;
  type: string;
  actorKind: SessionEvent['actor']['kind'];
  actorId: string;
  payload: unknown;
  createdAt: Date;
}): SessionEvent {
  return {
    id: row.id,
    sessionId: row.sessionId,
    seq: row.seq,
    type: row.type,
    actor: { kind: row.actorKind, id: row.actorId },
    payload: row.payload,
    createdAt: row.createdAt,
  };
}
